var debug = require('debug')('peerdata:channel');
var Emitter = require('emitter');

module.exports = PeerChannel;

function PeerChannel(peerData, label, options) {
  Emitter(this);
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
};

PeerChannel.prototype.close = function() {
  debug('close(%s)', this.label);
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
    console.log('peer datachannel event (replacing previous)', this.label, e.channel.label);
    if (this.label === e.channel.label) {
      // remove old listeners to avoid duplicates
      channel.onmessage = null;
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      peer.dataChannels[this.label] = initDataChannelEvents(e.channel, this);
    }
  }.bind(this));
  peer.dataChannels[this.label] = initDataChannelEvents(channel, this);
};

PeerChannel.prototype.removePeer = function(peer) {
  debug('removePeer(%s, %s)', this.label, peer.id);
  removeDataChannel(peer, this);
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
  var sent = 0;
  for (var id in peers) {
    var peer = peers[id];
    debug(' - %s %s', this.label, id, envelope);
    var channel = peer.dataChannels[this.label];
    if (channel && channel.readyState == 'open') {
      channel.send(json);
      sent += 1;
    } else {
      console.warn('sending to peer without open data channel', channel);
    }
  }
  return sent;
};


function guessType(message) {
  // TODO json if message it object, binary if message is array buffer or typed array
  return 'string';
}

function initDataChannelEvents(channel, emitter) {
  channel.onmessage = function(e) {
    debug('message', e.data);
    // TODO de-envelope
    var envelope = JSON.parse(e.data);
    emitter.emit('message', envelope.data, envelope.from);
  };
  channel.onopen = function(e) {
    debug('open');
    emitter.emit('open', e);
  };
  channel.onclose = function(e) {
    debug('close');
    emitter.emit('close', e);
  };
  channel.onerror = function(e) {
    debug('error', e);
    emitter.emit('error', e);
  };
  return channel;
}

function removeDataChannel(peer, peerChannel) {
  debug('removeDataChannel(%s, %s)', peer.id, peerChannel.label);
  var channel = peer.dataChannels[peerChannel.label];
  if (channel) {
    channel.close();
    channel.onmessage = null;
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    delete peer.dataChannels[peerChannel.label];
  }
}
