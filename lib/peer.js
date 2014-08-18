var debug = require('debug')('peerdata:peer');

// Fallbacks for vendor-specific variables until the spec is finalized.
var PeerConnection = window.webkitRTCPeerConnection ||
window.mozRTCPeerConnection ||
window.RTCPeerConnection;

module.exports = Peer;

// A challenge is per peer pair (in other words "me" and a peer). It's used in
// 'request-for-X' messages to know who to answer the request (the one with the
// bigger challenge wins).
//

function Peer(id, options) {
  debug('Peer(%s)', id);
  this.id = id;
  this.challenge = Date.now() + Math.random();
  this.peerConnection = new PeerConnection(options.servers);
  this.sendDataChannels = {}; // label => DataChannel (created by PeerChannel)
  this.recvDataChannels = {}; // label => DataChannel (created by PeerChannel)
}
