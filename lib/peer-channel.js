var debug = require('debug')('peer-data:peer-channel');
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

  if (this.state != 'new') {
    throw new Error('invalid state. must be new.');
  }

  this.state = 'opening';

  // store the listeners so we can safely stop listening on close
  this.listeners = {
    connected: this.addPeer.bind(this),
    disconnected: this.removePeer.bind(this),
    close: this.close.bind(this)
  };
  this.peerData.on('peer connected', this.listeners.connected);
  this.peerData.on('peer disconnected', this.listeners.disconnected);
  this.peerData.on('close', this.listeners.close);

  // add any previous peers
  // (in the case that the channel is created later)
  var peers = this.peerData.peers;
  for (var id in peers) {
    this.addPeer(peers[id]);
  }
};

PeerChannel.prototype.close = function() {
  debug('close(%s)', this.label);

  if (!~['opening', 'open'].indexOf(this.state)) {
    throw new Error('invalid state. must be opening or open.');
  }

  this.state = 'closing';
  var peers = this.peerData.peers;
  for (var id in peers) {
    this.removePeer(peers[id]);
  }
  this.peerData.off(this.listeners.connected);
  this.peerData.off(this.listeners.disconnected);
  this.peerData.off(this.listeners.close);
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
  var type = guessType(message);
  var envelope = {
    from: this.peerData.from,
    type: type,
    data: serialize(type, message)
  };
  var json = JSON.stringify(envelope);
  for (var id in peers) {
    var peer = peers[id];
    var channel = peer.sendDataChannels[this.label];
    debug(' - %s %s', this.label, channel.readyState, id, envelope);
    if (channel && channel.readyState == 'open') {
      channel.send(json);
    } else {
      debug('attempting to send message to a peer without an open data channel', channel);
    }
  }
};

function serialize(type, message) {
  switch(type) {
    case 'json': return JSON.stringify(message);
    case 'string': return message;
    case 'binary': return encode(message);
  }
}

function deserialize(type, message) {
  switch(type) {
    case 'json': return JSON.parse(message);
    case 'string': return message;
    case 'binary': return decode(message);
  }
}

function guessType(message) {
  if (typeof message == 'string') {
    return 'string';
  } else if (typeof message == 'object' && (a.buffer || a) instanceof ArrayBuffer) {
    return 'binary';
  }
  return 'json';
}

function initDataChannelEvents(channel, emitter, remote) {
  debug('init data channel events', remote ? 'remote' : 'local', emitter.label, channel.id);
  if (remote) {
    channel.onmessage = function(e) {
      debug('data channel message', remote ? 'remote' : 'local', e);
      var envelope = JSON.parse(e.data);
      var message = deserialize(envelope.type, envelope.data);
      emitter.emit('message', message, envelope.from);
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
      // TODO shouldn't we make sure all channels are closed before marking
      // the peer-channel as closed?
      // if (emitter.state != 'closed') {
      //   emitter.state = 'closed';
      //   emitter.emit('close', e);
      // }
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

function encode(binary){
  var string = String.fromCharCode.apply(null, new Uint8Array(binary));
  return decodeURIComponent(escape(string));
}
function decode(string){
  string = unescape(encodeURIComponent(string));
  var binary = new ArrayBuffer(string.length);
  var view = new Uint8Array(binary);
  for (var i=0; i<string.length; i++) {
    view[i] = string.charCodeAt(i);
  }
  return binary;
}