var debug = require('debug')('peerdata:channel');
var Emitter = require('emitter');

module.exports = PeerChannel;

function PeerChannel(peerData, label, options) {
  Emitter(this);
  this.state = 'new'; // new > opening > open > closing > closed
  this.peerData = peerData;
  this.label = label;
  this.options = options;
  this.open();
}

PeerChannel.prototype.open = function() {
  debug('open(%s)', this.label);
  this.peerData.on('peer connected', function(peer) {
    this.addPeer(peer);
  }.bind(this));
  this.peerData.on('peer disconnected', function(peer) {
    this.removePeer(peer);
  }.bind(this));
  this.peerData.on('close', function(e) {
    this.close();
  }.bind(this));
  this.state = 'opening';
};

PeerChannel.prototype.close = function() {
  debug('close(%s)', this.label);
  this.state = 'closing';
  var peers = this.peerData.peers;
  for (var id in peers) {
    this.removePeer(peers[id]);
  }
  this.peerData.off(); // TODO this will break multiple PeerChannel instances...
  this.peerData = null;
};

PeerChannel.prototype.addPeer = function(peer) {
  debug('addPeer(%s, %s)', this.label, peer.id);
  var channel = peer.peerConnection.createDataChannel(this.label, this.options);
  peer.peerConnection.addEventListener('datachannel', function(e) {
    if (this.label === e.channel.label) {
      peer.recvDataChannels[this.label] = initDataChannelEvents(e.channel, this, true);
    }
  }.bind(this));
  peer.sendDataChannels[this.label] = initDataChannelEvents(channel, this);
};

PeerChannel.prototype.removePeer = function(peer) {
  debug('removePeer(%s, %s)', this.label, peer.id);
  removeDataChannel(peer, this, peer.recvDataChannels[this.label]);
  removeDataChannel(peer, this, peer.sendDataChannels[this.label]);
  delete peer.recvDataChannels[this.label];
  delete peer.sendDataChannels[this.label];
};

PeerChannel.prototype.send = function(message) {
  debug('send(%s, %s)', this.label, message);
  var peers = this.peerData.peers;
  var envelope = {
    from: this.peerData.from,
    type: guessType(message),
    data: message
  };
  var json = JSON.stringify(envelope);
  for (var id in peers) {
    var peer = peers[id];
    var channel = peer.sendDataChannels[this.label];
    debug(' - %s %s', this.label, channel.readyState, id, envelope);
    if (channel && channel.readyState == 'open') {
      channel.send(json);
    } else {
      console.warn('sending to peer without open data channel', channel);
    }
  }
};


function guessType(message) {
  // TODO json if message it object, binary if message is array buffer or typed array
  return 'string';
}

function initDataChannelEvents(channel, emitter, remote) {
  debug('init data channel events', remote ? 'remote' : 'local', emitter.label, channel.id);
  if (remote) {
    channel.onmessage = function(e) {
      debug('data channel message', remote ? 'remote' : 'local', e);
      // TODO de-envelope
      var envelope = JSON.parse(e.data);
      emitter.emit('message', envelope.data, envelope.from);
    };
  } else {
    channel.onopen = function(e) {
      debug('data channel open', remote ? 'remote' : 'local', e);

      // only emit once
      if (emitter.state != 'open') {
        emitter.state = 'open';
        emitter.emit('open', e);
      }
    };
    channel.onclose = function(e) {
      debug('data channel close', remote ? 'remote' : 'local', e);
      // only emit once
      if (emitter.state != 'closed') {
        emitter.state = 'closed';
        emitter.emit('close', e);
      }
    };
    channel.onerror = function(e) {
      debug('data channel error', remote ? 'remote' : 'local', e);
      emitter.emit('error', e);
    };
  }
  return channel;
}

function removeDataChannel(peer, peerChannel, channel) {
  debug('removeDataChannel(%s, %s)', peer.id, channel && channel.label);
  if (channel) {
    channel.close();
    channel.onmessage = null;
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
  }
}
