var debug = require('debug')('peer-data:peer-data');
var Emitter = require('emitter');
var PeerChannel = require('./peer-channel');
var Peer = require('./peer');

module.exports = PeerData;

function PeerData(signal){
  if( !(this instanceof PeerData) ){
    return new PeerData(signal);
  }
  if( typeof signal != 'object' ){
    throw new Error('invalid signal. must be an object.');
  }

  Emitter(this);
  this.signal = signal;
  this.from = null;
  this.peers = {};     // id => Peer
  this.channels = {};  // label => PeerChannel
  this.open();
}

PeerData.prototype.open = function(){
  debug('open');
  this.signal.on('open', function(e){
    // create a "from" Peer id field to be sent along on messages as "from"?
    this.from = e.peer;
  }.bind(this));
  this.signal.on('message', function(message){
    // TODO handle presence messages (connected, disconnected)
    //  - add and remove peers

    // TODO handle rtc messages (offer, answer & candidates)
    //  - redirect to the right peers' connection using `from` field
  }.bind(this));
  this.signal.on('close', function(){
    this.close();
  }.bind(this));
  if( this.signal.state != 'open' ){
    this.signal.open();
  }
  // TODO fail if open is called again...
};

PeerData.prototype.channel = function(label, options){
  debug('channel(%s)', label);
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

  // 1. close channels by emitting 'close'
  this.emit('close');

  // 2. disconnect from signal
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
