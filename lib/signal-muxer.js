var debug = require('debug')('peer-data:signal-muxer');
var Emitter = require('emitter');

module.exports = SignalMuxer;


function SignalMuxer(signal, parent) {
  Emitter(this);
  this.signal = signal;
  this.peers = parent.peers; // never re-assign.

  redirect('turn', signal, this);
  redirect('open', signal, this);
  redirect('close', signal, this);
  redirect('error', signal, this);
  redirect('message', signal, this);

  parent.on('peer connected', function(peer) {
    // create a signal channel on peer and listen for messages
    if (peer.signal) {
      console.warn('strange. the peer already has a signal data channel?', peer);
      return;
    }
    var id = peer.id;
    var channel = peer.peerConnection.createDataChannel('peer-data:signalling');
    channel.onmessage = function(e) {
      this.emit('message', e.data, id);
    }.bind(this);
    peer.signal = channel;
  }.bind(this));
  parent.on('peer disconnected', function(peer) {
    // remove signal channel and listeners
    if (peer.signal) {
      if (peer.signal.readyState == 'open') {
        peer.signal.close();
      }
      peer.signal.onmessage = null;
      peer.signal = null;
    }
  }.bind(this));
}

SignalMuxer.prototype.open = function() {
  debug('open()');
  return this.signal.open();
};

SignalMuxer.prototype.send = function(json, to) {
  debug('send(%s, %s)', json, to);
  var peer = to && this.peers[to];
  if (peer) {
    // check if the peer.signal channel is ready. if it is send using that
    // instead and skip the original signal...
    if (peer.signal && peer.signal.readyState == 'open') {
      console.log('sending signal message to %s using data channel.', to);
      return peer.signal.send(json);
    }
  }
  // otherwise fallback to use the parent signalling api
  return this.signal.send(json, to);
};

SignalMuxer.prototype.close = function() {
  debug('close()');
  return this.signal.close();
};


function redirect(event, from, to) {
  from.on(event, to.emit.bind(to, event));
}
