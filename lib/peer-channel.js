var debug = require('debug')('peerdata:channel');
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
    createDataChannel(peer, this);
  }.bind(this));
  this.peerData.on('peer disconnected', function(peer){
    removeDataChannel(peer, this);
  }.bind(this));
  this.peerData.on('close', function(e){
    this.close();
  }.bind(this));
};

PeerChannel.prototype.close = function(){
  debug('close');
  var peers = this.peerData.peers;
  for(var id in peers){
    removeDataChannel(peers[id], this);
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

function createDataChannel(peer, peerChannel){
  debug('createDataChannel(%s, %s)', peer.id, peerChannel.label);
  var channel = peer.peerConnection.createDataChannel(peerChannel.label, peerChannel.options);
  channel.onmessage = function(e){
    debug('message %s', peerChannel.label, e);
    peerChannel.emit('message', e);
  };
  channel.onopen = function(e){
    debug('open %s', peerChannel.label);
    peerChannel.emit('open', e);
  };
  channel.onclose = function(e){
    debug('close %s', peerChannel.label);
    peerChannel.emit('close', e);
  };
  channel.onerror = function(e){
    debug('error %s', peerChannel.label, e);
    peerChannel.emit('error', e);
  };
  peer.dataChannels[peerChannel.label] = channel;
}

function removeDataChannel(peer, peerChannel){
  debug('removeDataChannel(%s, %s)', peer.id, peerChannel.label);
  var channel = peer.dataChannels[peerChannel.label];
  if( channel ){
    channel.close();
    channel.onmessage = null;
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    delete peer.dataChannels[peerChannel.label];
  }
}
