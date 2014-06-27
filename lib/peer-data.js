var debug = require('debug')('peerdata:peerdata');
var Emitter = require('emitter');
var PeerChannel = require('./peer-channel');
var Peer = require('./peer');

module.exports = PeerData;

function PeerData(signal, options){
  if( !(this instanceof PeerData) ){
    return new PeerData(signal);
  }
  if( typeof signal != 'object' ){
    throw new Error('invalid signal. must be an object.');
  }

  Emitter(this);
  this.state = 'new';  // new > open > closed
  this.signal = signal;
  this.from = null;
  this.challenge = Date.now() + Math.random();
  this.peers = {};     // id => Peer
  this.channels = {};  // label => PeerChannel
  this.options = options || {
    servers: {
      iceServers: [
        {url: 'stun:stun.l.google.com:19302'}
      ]
    }
  };
  this.open();
}

PeerData.prototype.open = function(){
  debug('open');

  if( this.state != 'new' ){
    throw new Error('invalid state. must be new.');
  }

  this.signal.on('open', function(e){
    // create a "from" Peer id field to be sent along on messages as "from"?
    this.from = e.peer;

    // TODO instead of getting this on 'open' we should do the same as we
    // would do when signal was already open...

  }.bind(this));
  this.signal.on('message', function(json, from){
    // TODO handle presence messages (connected, disconnected)
    //  - add and remove peers
    if( json.type == 'connected' ){
      this.addPeer(json.peer);

    } else if( json.type == 'disconnected' ){
      this.removePeer(json.peer);

    } else if( json.type == 'full' ){


    } else {
      // handle rtc messages (offer, answer & candidates)
      //  - redirect to the right peers' connection using `from` field
      var peer = this.peers[from];
      if( peer ){
        if( json.type == 'request-for-offer' ){
          if( json.challenge < peer.challenge ){
            peer.peerConnection.createOffer(function(desc){
              peer.peerConnection.setLocalDescription(desc, function(){
                this.signal.send(desc, from);
              }, function(err){
                console.warn('failed to set local offer', err);
              });
            }, function(err){
              console.warn('failed to create offer', err);
            });
          }

        } else if( json.type == 'offer' ){
          var desc = new RTCSessionDescription(json);
          peer.peerConnection.setRemoteDescription(desc, function(){
            peer.peerConnection.createAnswer(function(desc){
              peer.peerConnection.setLocalDescription(desc, function(){
                this.signal.send(desc, from);
              }, function(err){
                console.warn('failed to set local answer', err);
              });
            }, function(err){
              console.warn('failed to create answer', err);
            });
          }, function(err){
            console.warn('failed to set remote offer', err);
          });

        } else if( json.type == 'answer' ){
          var desc = new RTCSessionDescription(json);
          peer.peerConnection.setRemoteDescription(desc, noop, function(err){
            console.warn('failed to set remote answer', err);
          });

        } else if( json.type == 'icecandidate' ){
          if( json.candidate ){
            var candidate = new RTCIceCandidate(json.candidate);
            peer.peerConnection.addIceCandidate(candidate, noop, function(err){
              console.warn('failed to add icecandidate', err);
            });
          } else {
            // console.log('received all icecandidates!');
          }
        }

      } else {
        console.warn('received message from a non-existing peer', from);
      }
    }

  }.bind(this));
  this.signal.on('close', function(){
    this.close();
  }.bind(this));

  if( this.signal.state != 'open' ){
    // wait a bit to let it disconnect first
    // TODO some better way to do this? maybe use a cookie and if it has
    // that cookie while requesting a token it should disconnect?
    setTimeout(function(){
      this.signal.open();
    }.bind(this), 3000);

  } else {
    // TODO request `this.from` and the current state of clients from signal.
  }

  this.state = 'open';
};

PeerData.prototype.addPeer = function(id){
  var peer = this.peers[id];
  if( !peer ){
    peer = new Peer(id, this.options);
  }
  var connection = peer.peerConnection;
  connection.ondatachannel = function(e){
    debug('datachannel', arguments);
  }.bind(this);
  connection.onicecandidate = function(e){
    debug('icecandidate', arguments);
    this.signal.send({
      type: 'icecandidate',
      candidate: e.candidate
    }, peer.id);
  }.bind(this);
  connection.oniceconnectionstatechange = function(e){
    debug('iceconnectionstatechange -> %s', connection.iceConnectionState, arguments);
  }.bind(this);
  connection.onsignalingstatechange = function(e){
    debug('signalingstatechange -> %s', connection.signalingState);
  }.bind(this);
  connection.onnegotiationneeded = function(e){
    debug('negotiationneeded', arguments);
  }.bind(this);
  this.peers[id] = peer;
  this.emit('peer connected', peer);
  this.signal.send({
    type: 'request-for-offer',
    challenge: peer.challenge
  }, peer.id);
};

PeerData.prototype.removePeer = function(id){
  var peer = this.peers[id];
  if( peer ){
    var connection = peer.peerConnection;
    connection.ondatachannel = null;
    connection.onicecandidate = null;
    connection.oniceconnectionstatechange = null;
    connection.onsignalingstatechange = null;
    connection.onnegotiationneeded = null;
    connection.close();
    this.emit('peer disconnected', peer);
    delete this.peers[id];
  } else {
    console.warn('tried to remove non-existing peer: '+id);
  }
};

PeerData.prototype.channel = function(label, options){
  debug('channel(%s)', label);

  if( this.state != 'open' ){
    throw new Error('invalid state. must be open.');
  }

  validateLabel(label);
  var channel = this.channels[label];
  if( !channel ){
    channel = new PeerChannel(this, label, options);
    this.channels[label] = channel;
  }
  return channel;
};

PeerData.prototype.close = function(){
  debug('close');

  if( this.state != 'open' ){
    throw new Error('invalid state. must be open.');
  }

  // set state so it cannot be used anymore
  this.state = 'closed';

  // 1. close channels by emitting 'close'
  this.emit('close');

  // 2. remove peers
  for(var id in this.peers){
    this.removePeer(id);
  }

  // 3. disconnect from signal
  this.signal.off(); // TODO this will break multiple PeerData instances...
  this.signal = null;
};


function validateLabel(label){
  if( !label ){
    throw new Error('missing label');
  }
  if( typeof label != 'string' ){
    throw new Error('label must be a string');
  }
  if( !label.trim() ){
    throw new Error('label cannot be an empty string');
  }
  if( /[^\w\d]/.test(label) ){
    throw new Error('label must contain ascii only');
  }
}

function noop(){}
