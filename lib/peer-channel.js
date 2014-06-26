var debug = require('debug')('peer-data:peer-channel');
var Emitter = require('emitter');

module.exports = PeerChannel;

function PeerChannel(peerData, label, options){
  Emitter(this);
  this.peerData = peerData;
  this.label = label;
  this.options = options;
  this.open();
}

PeerChannel.prototype.open = function(){
  debug('open');
  this.peerData.on('peer connected', function(peer){
    createDataChannel(peer, this.label);
  }.bind(this));
  this.peerData.on('peer disconnected', function(peer){
    removeDataChannel(peer, this.label);
  }.bind(this));
  this.peerData.on('close', function(e){
    this.close();
  }.bind(this));
};

PeerChannel.prototype.close = function(){
  debug('close');
  var peers = this.peerData.peers;
  for(var id in peers){
    removeDataChannel(peers[id], this.label);
  }
  this.peerData.off(); // TODO this will break multiple PeerChannel instances...
  this.peerData = null;
};

PeerChannel.prototype.send = function(message){
  debug('send(%s)', message);
  var peers = this.peerData.peers;
  var envelope = {
    from: this.peerData.from,
    type: guessType(message),
    data: message
  };
  var json = JSON.stringify(envelope);
  for(var id in peers){
    var peer = peers[id];
    peer.dataChannels[this.label].send(json);
  }
};


function guessType(message){
  // TODO json if message it object, binary if message is array buffer or typed array
  return 'string';
}

function createDataChannel(peer, label, options){
  var channel = peer.peerConnection.createDataChannel(label, options);
  channel.onmessage = function(e){
    debug('message %s', label, e);
  };
  channel.onopen = function(e){
    debug('open %s', label);
  };
  channel.onclose = function(e){
    debug('close %s', label);
  };
  channel.onerror = function(e){
    debug('error %s', label, e);
  };
  peer.dataChannels[label] = channel;
}

function removeDataChannel(peer, label){
  var channel = peer.dataChannels[label];
  if( channel ){
    channel.close();
    channel.onmessage = null;
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    delete peer.dataChannels[label];
  }
}
