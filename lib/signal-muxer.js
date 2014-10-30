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
    if (peer.sendSignal || peer.recvSignal) {
      console.warn('strange. the peer already has a signal data channel?', peer);
      return;
    }
    var id = peer.id;
    var label = 'peer-data:signalling';
    peer.sendSignal = peer.channel(label);

    peer.connection.addEventListener('datachannel', function(e) {
      var channel = e.channel;
      if (!peer.recvSignal && channel.label == label) {
        channel.onmessage = function(e) {
          var message = JSON.parse(e.data);
          this.emit('message', message, id);
        }.bind(this);
        peer.recvSignal = channel;
      }
    }.bind(this));
  }.bind(this));
  parent.on('peer disconnected', function(peer) {
    // remove signal channel and listeners
    if (peer.sendSignal) {
      if (peer.sendSignal.readyState == 'open') {
        peer.sendSignal.close();
      }
      peer.sendSignal = null;
    }
    if (peer.recvSignal) {
      if (peer.recvSignal.readyState == 'open') {
        peer.recvSignal.close();
      }
      peer.recvSignal = null;
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
    if (peer.sendSignal && peer.sendSignal.readyState == 'open') {
      var message = JSON.stringify(json);
      return peer.sendSignal.send(message);
    }
  }
  // otherwise fallback to use the parent signalling api
  return this.signal.send(json, to);
};

SignalMuxer.prototype.close = function() {
  debug('close()');
  return this.signal.close();
};


Object.defineProperty(SignalMuxer.prototype, 'state', {
  get: function () {
    return this.signal.state;
  }
});

function redirect(event, from, to) {
  from.on(event, to.emit.bind(to, event));
}
