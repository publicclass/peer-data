var debug = require('debug')('peer-data:peer');
var Emitter = require('emitter');

// Fallbacks for vendor-specific variables until the spec is finalized.
var PeerConnection = window.webkitRTCPeerConnection ||
                     window.mozRTCPeerConnection ||
                     window.RTCPeerConnection;


module.exports = Peer;

function Peer(id, options){
  debug('Peer(%s)', id);
  this.id = id;
  this.peerConnection = createConnection(options);
  this.dataChannels = {}; // label => DataChannel (created by PeerChannel)
}

function createConnection(options){
  var connection = new PeerConnection(options.servers);
  connection.onaddstream = function(e){
    debug('addstream', arguments);
  };
  connection.onremovestream = function(e){
    debug('removestream', arguments);
  };
  connection.ondatachannel = function(e){
    debug('datachannel', arguments);
  };
  connection.onicecandidate = function(e){
    debug('icecandidate', arguments);
  };
  connection.oniceconnectionstatechange = function(e){
    debug('iceconnectionstatechange -> %s', connection.iceConnectionState, arguments);
  };
  connection.onsignalingstatechange = function(e){
    debug('signalingstatechange -> %s', connection.signalingState);
  };
  connection.onnegotiationneeded = function(e){
    debug('negotiationneeded', arguments);
  };
  return connection;
}
