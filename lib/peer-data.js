var debug = require('debug')('peer-data:peer-data');
var Emitter = require('emitter');
var PeerChannel = require('./peer-channel');
var Peer = require('./peer');
var SignalMuxer = require('./signal-muxer');
var rtc = require('./rtc');

module.exports = PeerData;

function PeerData(signal, options) {
  if (!(this instanceof PeerData)) {
    return new PeerData(signal);
  }
  if (typeof signal != 'object') {
    throw new Error('invalid signal. must be an object.');
  }

  Emitter(this);
  this.state = 'new'; // new > opening > open > closed
  this.peers = {}; // id => Peer
  this.channels = {}; // label => PeerChannel
  this.signal = new SignalMuxer(signal, this);
  this.from = null;
  this.challenge = Date.now() + Math.random();
  this.options = options || {
    connection: {
      iceServers: [
        {
          url: 'stun:stun.l.google.com:19302'
        }
      ]
    },
    mediaContraints: {
      constraints: {
        mandatory: {
          OfferToReceiveVideo:true,
          OfferToReceiveAudio:true
        },
        optional: {
          VoiceActivityDetection:false
        }
      }
    }
  };
  this.open();
}

PeerData.prototype.open = function() {
  debug('open()');

  if (this.state != 'new') {
    throw new Error('invalid state. must be new.');
  }

  // keep track of the listeners so we can safely remove them
  this.listeners = {};

  // a signal may receive the turn configuration from the server, in
  // which case it will emit it so we can add it to
  // `options.servers.iceServers`.
  this.listeners.turn = function(config) {
    config = rtc.turnConfig(config);
    if (config) {  // turnConfig may return null
      this.options.connection.iceServers.push(config);
    }
  }.bind(this);

  this.listeners.open = function(e) {
    // create a "from" Peer id field to be sent along on messages as "from"?
    this.from = e.peer;
    this.state = 'open';
  }.bind(this);

  this.listeners.message = function(json, from) {
    // handle presence messages (connected, disconnected)
    //  - add and remove peers
    if (json.type == 'connected') {
      this.addPeer(json.peer);

    } else if (json.type == 'disconnected') {
      this.removePeer(json.peer);

    } else if (json.type == 'full') {
      // TODO close?
      this.emit('error', new Error('room is full'));

    } else {
      // handle rtc messages (offer, answer & candidates)
      //  - redirect to the right peers' connection using `from` field
      var peer = this.peers[from];
      if (peer) {
        if (json.type == 'request-for-offer') {
          var winner = json.challenge < peer.challenge;
          debug('recv request-for-offer', winner && '(winner)');
          if (winner) {
            peer.connection.createOffer(function(desc) {
              peer.connection.setLocalDescription(desc, function() {
                debug('send offer', [desc]);
                this.signal.send(desc, from);
              }.bind(this), function(err) {
                console.warn('failed to set local offer', err);
              }.bind(this));
            }.bind(this), function(err) {
              console.warn('failed to create offer', err);
            }.bind(this), this.options.mediaConstraints);
          }

        } else if (json.type == 'offer') {
          debug('recv offer', [json]);
          var odesc = new rtc.SessionDescription(json);
          peer.connection.setRemoteDescription(odesc, function() {
            peer.connection.createAnswer(function(desc) {
              peer.connection.setLocalDescription(desc, function() {
                debug('send answer', [desc]);
                this.signal.send(desc, from);
              }.bind(this), function(err) {
                console.warn('failed to set local answer', err);
              }.bind(this));
            }.bind(this), function(err) {
              console.warn('failed to create answer', err);
            }.bind(this), this.options.mediaConstraints);
          }.bind(this), function(err) {
            console.warn('failed to set remote offer', err);
          }.bind(this));

        } else if (json.type == 'answer') {
          debug('recv answer', [json]);
          var adesc = new rtc.SessionDescription(json);
          peer.connection.setRemoteDescription(adesc, noop, function(err) {
            console.warn('failed to set remote answer', err);
          }.bind(this));

        } else if (json.type == 'icecandidate') {
          debug('recv icecandidate', json.candidate ? [json] : '(completed)');
          if (json.candidate) {
            var candidate = new rtc.IceCandidate(json.candidate);
            peer.connection.addIceCandidate(candidate, noop, function(err) {
              console.warn('failed to add icecandidate', err);
            }.bind(this));
          }
        }

      } else {
        console.warn('received message from a non-existing peer', from);
      }
    }
  }.bind(this);

  this.listeners.close = function() {
    this.close();
  }.bind(this);

  this.state = 'opening';

  this.signal.on('turn', this.listeners.turn);
  this.signal.on('open', this.listeners.open);
  this.signal.on('close', this.listeners.close);
  this.signal.on('message', this.listeners.message);
  this.signal.open();
};

PeerData.prototype.addPeer = function(id) {
  var peer = this.peers[id];
  if (!peer) {
    peer = new Peer(id, this.options);
  }
  var connection = peer.connection;
  connection.ondatachannel = function(e) {
    debug('datachannel', e.channel.label);
  }.bind(this);
  connection.onicecandidate = function(e) {
    debug('icecandidate', e.candidate);
    this.signal.send({
      type: 'icecandidate',
      candidate: e.candidate
    }, peer.id);
  }.bind(this);
  connection.oniceconnectionstatechange = function(e) {
    debug('iceconnectionstatechange -> %s / %s', connection.iceConnectionState, connection.iceGatheringState);
    this.emit('peer state changed', peer);
    if (connection.iceConnectionState == 'disconnected') {
      this.updateState();
    }
  }.bind(this);
  connection.onsignalingstatechange = function(e) {
    debug('signalingstatechange -> %s', connection.signalingState);
    this.emit('peer state changed', peer);
  }.bind(this);
  connection.onnegotiationneeded = function(e) {
    debug('negotiationneeded');

    debug('send request-for-offer');
    this.signal.send({
      type: 'request-for-offer',
      challenge: peer.challenge
    }, peer.id);
  }.bind(this);
  this.peers[id] = peer;
  this.emit('peer connected', peer);

  this.signal.send({
    type: 'request-for-offer',
    challenge: peer.challenge
  }, peer.id);
};

PeerData.prototype.removePeer = function(id) {
  var peer = this.peers[id];
  if (peer) {
    var connection = peer.connection;
    connection.ondatachannel = null;
    connection.onicecandidate = null;
    connection.oniceconnectionstatechange = null;
    connection.onsignalingstatechange = null;
    connection.onnegotiationneeded = null;
    connection.close();
    this.emit('peer disconnected', peer);
    delete this.peers[id];
  } else {
    console.warn('tried to remove non-existing peer: ' + id);
  }
};

PeerData.prototype.channel = function(label, options) {
  debug('channel(%s)', label);

  if (!~['open', 'opening'].indexOf(this.state)) {
    throw new Error('invalid state. must be open or opening.');
  }

  validateLabel(label);
  var channel = this.channels[label];
  if (!channel) {
    channel = new PeerChannel(this, label, options);
    this.channels[label] = channel;
  }
  return channel;
};

PeerData.prototype.close = function() {
  debug('close');

  if (!~['open', 'opening'].indexOf(this.state)) {
    throw new Error('invalid state. must be open or opening.');
  }

  // set state so it cannot be used anymore
  this.state = 'closed';

  // 1. close channels by emitting 'close'
  this.emit('close');

  // 2. remove peers
  for (var id in this.peers) {
    this.removePeer(id);
  }

  // 3. disconnect from signal
  this.signal.off(this.listeners.turn);
  this.signal.off(this.listeners.open);
  this.signal.off(this.listeners.message);
  this.signal.off(this.listeners.close);
};


PeerData.prototype.updateState = function() {
  debug('updateState(%s)', this.label);
  var peers = this.peers;
  var id, peer, channel;

  if (this.state != 'open') {
    console.log('open?');
    for (id in peers) {
      peer = peers[id];
      console.log(' - %s: %s', id, peer.connection.iceConnectionState);
      if (peer.connection.iceConnectionState == 'open') {
        this.state = 'open';
        this.emit('open');
        return;
      }
    }

  }

  if (this.state != 'closed') {
    console.log('closed?');
    for (id in peers) {
      peer = peers[id];
      console.log(' - %s: %s', id, peer.connection.iceConnectionState);
      if (peer.connection.iceConnectionState != 'disconnected') {
        return;
      }
    }
    this.close();
  }

};


function validateLabel(label) {
  if (!label) {
    throw new Error('missing label');
  }
  if (typeof label != 'string') {
    throw new Error('label must be a string');
  }
  if (!label.trim()) {
    throw new Error('label cannot be an empty string');
  }
  if (/[^\w\d]/.test(label)) {
    throw new Error('label must contain ascii only');
  }
}

function noop() {
}
