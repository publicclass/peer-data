var debug = require('debug')('peer-data:peer');
var Emitter = require('emitter');
var rtc = require('./rtc');

module.exports = Peer;

// A challenge is per peer pair (in other words "me" and a peer). It's used in
// 'request-for-X' messages to know who to answer the request (the one with the
// bigger challenge wins).
//
function Peer(id, options) {
  debug('Peer(%s)', id, options);
  Emitter(this);
  this.id = id;
  this.challenge = Date.now() + Math.random();
  this.connection = new rtc.PeerConnection(options.connection);
  this.connection.addEventListener('datachannel', this.ondatachannel.bind(this));
  this.channels = {}; // label => DataChannel
  this._channels = []; // to keep the channels from GC
}

Peer.prototype.send = function(label, message){
  var channel = this.channel(label);
  if (channel && channel.readyState == 'open') {
    return channel.send(message);
  }
  return false;
};

Peer.prototype.channel = function(label, options){
  if (this.channels[label]) {
    return this.channels[label];
  }

  var channel = this.connection.createDataChannel(label, options);
  this.channels[label] = channel;
  this._channels.push(channel);
  observeDataChannelEvents(channel, this);
  return channel;
};

Peer.prototype.ondatachannel = function(e){
  var channel = e.channel;
  this.channels[channel.label] = channel;
  this._channels.push(channel);
  observeDataChannelEvents(channel, this);
};


function observeDataChannelEvents(channel, emitter) {
  channel.addEventListener('open', emitter.emit.bind(emitter, 'open'));
  channel.addEventListener('close', emitter.emit.bind(emitter, 'close'));
  channel.addEventListener('error', emitter.emit.bind(emitter, 'error'));
  channel.addEventListener('message', emitter.emit.bind(emitter, 'message'));
}