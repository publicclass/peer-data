
module.exports = (function(){
  var PeerConnection = this.webkitRTCPeerConnection ||
                       this.mozRTCPeerConnection ||
                       this.RTCPeerConnection;
  if( typeof PeerConnection == 'function' &&
      PeerConnection.prototype &&
      typeof PeerConnection.prototype.createDataChannel == 'function' ){
    try {
      var pc = new PeerConnection(null);
      pc.createDataChannel('peer-data:supported').close();
      return true;
    } catch(e){
      return false;
    }
  } else {
    return false;
  }
})();