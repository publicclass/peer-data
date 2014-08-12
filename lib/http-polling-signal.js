var debug = require('debug')('peerdata:httppollingsignal');
var Emitter = require('emitter');

module.exports = HTTPPollingSignal;

function HTTPPollingSignal(options) {
  if (!(this instanceof HTTPPollingSignal)) {
    return new HTTPPollingSignal(options);
  }
  if (typeof options != 'object') {
    throw new Error('invalid options. must be an object.');
  }
  if (!options.room) {
    throw new Error('invalid room name. must be a string longer than 1.');
  }

  Emitter(this);
  this.state = 'new'; // new > opening > open > closing > close
  this.room = options.room;
  this.prefix = options.prefix || '/channel';
  this.peer = null;
  this.socket = null;
  this.sequence = {}; // peer.id => {seq, msg[], rcv}
  this.messages = []; // sending queue
}

HTTPPollingSignal.prototype.open = function() {
  debug('open()');
  if (this.state != 'new') {
    return console.warn('signal already open or has been closed');
  }
  this.state = 'opening';

  // 1. request a token and peer id
  token(this.prefix, this.room, function(err, data) {
    if (err) {
      console.error('error while requesting token', err);
      return this.emit('error', err);
    }

    this.peer = data.peer;
    this.retries = 0;

    if (data.turn) {
      this.emit('turn', data.turn);
    }

    // create a polling socket
    this.socket = poll(this.prefix, this.room, this.peer, this.messages);
    this.socket.onopen = this.onopen.bind(this);
    this.socket.onmessage = this.onmessage.bind(this);
    this.socket.onerror = this.onerror.bind(this);
    this.socket.onclose = this.onclose.bind(this);

  }.bind(this));
};

HTTPPollingSignal.prototype.onmessage = function(e) {
  debug('onmessage', e);
  var q;
  try {
    if (typeof e.data == 'string') {
      q = JSON.parse(e.data);
    } else {
      q = e.data;
    }
  } catch (err) {
    console.error('error while parsing message', e.data);
    this.emit('error', err);
    return;
  }

  // 1. handle server messages (connected, disconnected, room full)
  if (q.type == 'connected') {
    // a peer connected
    if (q.peer === this.peer) {
      return console.warn('ignoring connected, it was myself...');
    }
    this.emit('message', q);

  } else if (q.type == 'disconnected') {
    // a peer disconnected
    if (q.peer === this.peer) {
      return console.warn('ignoring disconnected, it was myself...');
    }
    this.emit('message', q);

  } else if (q.type == 'full') {
    // room was full
    // TODO retry a few times to work around the unruly presence check in
    //      the channel api. exponential backoff with 5 attempts. then if
    //      it still is full emit message with type: 'full'.
    if (this.retries < 5) {
      var wait = Math.pow(2, this.retries) * 1000 + Math.random() * 1000;
      setTimeout(function() {
        this.send({
          type: 'reconnect'
        });
        this.retries += 1;
      }.bind(this), wait);
    } else {
      this.emit('message', q);
    }


    // 2. handle client messages
  } else {
    // fix the ordering of messages here
    var data;
    try {
      data = JSON.parse(q.data);
    } catch (err) {
      console.error('error while parsing message', q.data);
      this.emit('error', err);
      return;
    }

    var seq = this.sequence[q.from];
    if (!seq) {
      seq = {
        seq: 0,
        rcv: -1,
        msg: []
      };
      this.sequence[q.from] = seq;
    }

    if (data.seq <= seq.rcv) {
      console.warn('received a message older, or equal to, than our last received. dropping it.', data.seq, seq.rcv);
      return;

    } else if (data.seq > seq.rcv + 1) {
      // message from the future. queue it up.
      // console.warn('received a message from the future. will queue it up.', data.seq, seq.rcv);
      seq.msg.push(data.seq, e);
      return;

    } else {
      // message correct
      seq.rcv = data.seq;
      delete data.seq;

      // flush out any queued up messages now that we've bumped received
      setTimeout(this.flush.bind(this, q.from), 10);

    }

    this.emit('message', data, q.from);
  }
};

HTTPPollingSignal.prototype.onopen = function() {
  debug('onopen');
  this.state = 'open';
  this.sequence = {}; // reset all sequences
  this.emit('open');
};

HTTPPollingSignal.prototype.onerror = function(err) {
  debug('onerror', err);
  // TODO should we close here if open?
  console.error('socket error', err);
  this.emit('error', err);
};

HTTPPollingSignal.prototype.onclose = function() {
  debug('onclose');
  this.socket.onopen = null;
  this.socket.onerror = null;
  this.socket.onclose = null;
  this.socket.onmessage = null;
  this.socket = null;
  this.state = 'closed';
  this.emit('close');
};

HTTPPollingSignal.prototype.flush = function(peer) {
  debug('flush(%s)', peer);
  var seq = this.sequence[peer];
  if (seq) {
    for (var i = 0; i < seq.msg.length; i += 2) {
      var sequence = seq.msg[i];
      var message = seq.msg[i + 1];
      if (sequence == seq.rcv + 1) {
        seq.msg.splice(i, 2);
        this.socket.onmessage(message);
        break; // it will be resumed after the message was processed
      }
    }
  }
};

HTTPPollingSignal.prototype.close = function() {
  debug('close()');
  if (this.state != 'open') {
    return console.warn('signal not open');
  }
  this.state = 'closing';
  this.socket.close();
};

HTTPPollingSignal.prototype.send = function(json, to) {
  debug('send(%j)', json);
  if (this.state != 'open') {
    return console.warn('cannot send messages on an not-open signal');
  }

  if (typeof json != 'object') {
    throw new Error('invalid message type. must be an object.');
  }

  // always add a sequence to the client messages so we can order them when
  // they arrive
  if (to) {
    if (!this.sequence[to]) {
      this.sequence[to] = {
        seq: 0,
        rcv: -1,
        msg: []
      };
    }
    json.seq = this.sequence[to].seq;
  }

  var message;
  try {
    message = JSON.stringify(json);
  } catch (e) {
    console.warn('failed to stringify json', e);
    this.emit('error', e);
    return;
  }

  if (to) {
    this.sequence[to].seq++;
  }

  // add to messages queue (to be processed by the polling socket)
  this.messages.push([to, message]);
};


function token(prefix, room, fn) {
  debug('token(%s, %s)', prefix, room);
  var req = new XMLHttpRequest();
  req.onload = function() {
    if (req.readyState == 4 && req.status == 200) {
      var q;
      try {
        q = JSON.parse(req.responseText);
      } catch (e) {
        fn(new Error('failed to parse the token results from:' + req.responseText));
      }
      if (q.peer) {
        fn(null, q);
      } else {
        fn(new Error('missing peer id from results'));
      }
    }
  };
  req.onerror = fn;
  req.open('GET', prefix + '/' + room, true);
  req.send();
}

function poll(prefix, room, peer, messages) {
  var socket = {};

  // a polling socket:
  // 1. connects (and calls 'onopen' when connected)
  // 2. polls for messages (and calls 'onmessage' for each)
  // 3. if polling fails (it calls 'onerror')
  // 4. if connection times out (it calls 'onclose')

  function post(state) {
    var url = prefix + '/' + room + '/' + peer;

    if (state == 'open') {
      url += '/connected';
    } else if (state == 'close') {
      url += '/disconnected';
    }

    // TODO add a timeout
    // TODO retry with backoff

    var sync = state == 'close'; // sync when closing
    var json = '';
    if (messages.length) {
      json = JSON.stringify(messages);
      // reset the sending queue
      // TODO maybe just set them to pending so that they won't get lost in case
      // of error?
      messages.length = 0;
    }

    var req = new XMLHttpRequest();
    req.onload = function() {
      if (req.readyState == 4 && req.status == 200) {
        var q;
        try {
          q = JSON.parse(req.responseText);
        } catch (e) {
          fn(new Error('failed to parse the token results from:' + req.responseText));
          return;
        }

        if (state == 'open') {
          console.log(q); // TODO check that it's not full (in which case, what?)
          // initial connection, call socket.onopen()
          socket.onopen(q);

        } else if (state == 'close' || q.state == 'disconnected') {
          // connection closed, either by server or by user call socket.onclose()
          socket.onclose(q);

        } else if (Array.isArray(q)) {
          // received a list of messages, call socket.onmessage() for each
          for (var i = 0; i < q.length; i++) {
            var m;
            try {
              m = JSON.parse(q[i]);
            } catch (e) {
              return socket.onerror(new Error('failed to parse the message from: ' + q[i]));
            }
            socket.onmessage({
              data: m
            });
          }

        } else {
          console.log('polling response', q);
        }

        return setTimeout(post, 1000); // poll again in a second
      }
    };
    req.onerror = function(err) {
      socket.onerror(err);
    };
    req.open('POST', url, !sync);
    req.setRequestHeader('Content-Type', 'application/json');
    req.send(json);
  }

  post('open');

  socket.close = function closeSocket() {
    post('close');
  };

  if (typeof window != 'undefined') {
    window.addEventListener('beforeunload', function unload() {
      console.log('unloading the window. should attempt to close the signal.');
      socket.close();
    });
  }

  return socket;
}
