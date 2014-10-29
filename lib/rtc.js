var rtc = exports;

// wrap in function to make `this` global
(function(){
  rtc.PeerConnection = this.webkitRTCPeerConnection || this.mozRTCPeerConnection || this.RTCPeerConnection;
  rtc.IceCandidate = this.mozRTCIceCandidate || this.RTCIceCandidate;
  rtc.SessionDescription = this.mozRTCSessionDescription || this.RTCSessionDescription;

  rtc.supported = (function(){
    if( typeof rtc.PeerConnection == 'function' &&
        rtc.PeerConnection.prototype &&
        typeof rtc.PeerConnection.prototype.createDataChannel == 'function' ){
      try {
        var pc = new rtc.PeerConnection(null);
        pc.createDataChannel('peer-data:supported').close();
        return true;
      } catch(e){
        return false;
      }
    } else {
      return false;
    }
  })();
})();

rtc.turnConfig = function(config) {
  if (navigator.mozGetUserMedia) {
    // in firefox username must be separate from the uri or it
    // raises an exception. so strip it off.
    config.url = config.url.replace(/turn:[^:]+:/, 'turn:');
  }
  return config;
};