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
};

PeerChannel.prototype.addPeer = function(peer) {
  debug('addPeer(%s, %s)', this.label, peer.id);
  var channel = peer.channel(this.label);
  channel.onopen = this.onpeeropen.bind(this, peer);
  channel.onclose = this.onpeerclose.bind(this, peer);
  channel.onerror = this.onpeererror.bind(this, peer);
  channel.onmessage = this.onpeermessage.bind(this, peer);
};

PeerChannel.prototype.removePeer = function(peer) {
  debug('removePeer(%s, %s)', this.label, peer.id);
  var channel = peer.channel(this.label);
  if (channel.readyState == 'open') {
    this.onpeerclose(peer);
  }
};

PeerChannel.prototype.send = function(message) {
  debug('send(%s, %s)', this.label, message);

  if (this.state != 'open') {
    console.warn('peer channel not open. ignoring send.');
    return false;
  }

  var sent = false;
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
    debug(' - %s %s', this.label, id, envelope);
    if (peer.send(this.label, json)) {
      sent = true;
    }
  }
  return sent;
};

PeerChannel.prototype.onpeeropen = function(peer, e) {
  debug('onpeeropen(%s, %s)', this.label, peer.id);
  this.updateState();
};

PeerChannel.prototype.onpeerclose = function(peer, e) {
  debug('onpeerclose(%s, %s)', this.label, peer.id);
  var channel = peer.channel(this.label);
  if (channel.readyState == 'open') {
    channel.close();
  }
  channel.onopen = null;
  channel.onclose = null;
  channel.onerror = null;
  channel.onmessage = null;
  this.updateState();
};

PeerChannel.prototype.onpeererror = function(peer, e) {
  debug('onpeererror(%s, %s)', this.label, peer.id);
  // TODO should we close and cleanup here?
  this.emit('error', e);
};

PeerChannel.prototype.onpeermessage = function(peer, e) {
  debug('onpeermessage(%s, %s)', this.label, peer.id);
  var envelope = JSON.parse(e.data);
  var message = deserialize(envelope.type, envelope.data);
  this.emit('message', message, envelope.from);
};

PeerChannel.prototype.updateState = function() {
  debug('updateState(%s)', this.label);
  var peers = this.peerData.peers;
  var id, peer, channel;
  if (this.state != 'open') {
    console.log('open?');
    for (id in peers) {
      peer = peers[id];
      channel = peer.channel(this.label, this.options);
      console.log(' - %s: %s', id, channel.readyState);
      if (channel.readyState == 'open') {
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
      channel = peer.channel(this.label, this.options);
      console.log(' - %s: %s', id, channel.readyState);
      if (channel.readyState != 'closed') {
        return;
      }
    }

    this.peerData.off('peer connected', this.listeners.connected);
    this.peerData.off('peer disconnected', this.listeners.disconnected);
    this.peerData.off('close', this.listeners.close);
    this.state = 'closed';
    this.emit('close');
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