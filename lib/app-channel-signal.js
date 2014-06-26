var debug = require('debug')('peer-data:app-channel-signal');
var Emitter = require('emitter');

var PREFIX = '/channel';

function AppChannelSignal(options){
  if( !(this instanceof AppChannelSignal) ){
    return new AppChannelSignal(options);
  }
  if( typeof options != 'object' ){
    throw new Error('invalid options. must be an object.');
  }
  if( !options.room ){
    throw new Error('invalid room name. must be a string longer than 1.');
  }

  Emitter(this);
  this.state = 'new'; // new > opening > open > closing > close
  this.room = options.room;
  this.peer = null;
  this.token = null;
  this.socket = null;
  this.sequence = 0;
}

AppChannelSignal.prototype.open = function(){
  debug('open()');
  if( this.state != 'new' ){
    return console.warn('signal already open or has been closed');
  }
  this.state = 'opening';

  // 1. make sure javascript is embedded
  embedScript(function(err){
    if(err){
      return this.emit('error', err);
    }

    // 2. request a token and peer id
    requestToken(function(err, data){
      if(err){
        return this.emit('error', err);
      }

      this.token = data.token;
      this.peer = data.peer;

      // 3. create a channel socket and when socket is opened,
      //    emit 'open' along with peer id
      var channel = new goog.appengine.Channel(token);
      this.socket = channel.open();
      this.socket.onmessage = function(e){
        var q;
        try {
          q = JSON.parse(e.data);
        } catch(err){
          this.emit('error', err);
          return;
        }

        // 1. handle server messages (connected, disconnected, room full)
        // 2. handle client messages
        // TODO fix the ordering of messages here

        this.emit('message', q);
      };
      this.socket.onopen = function(){
        this.state = 'open';
        this.sequence = 0;
        this.emit('open', {peer: peer});
      }.bind(this);
      this.socket.onerror = function(err){
        // TODO should we close here if open?
        this.emit('error', err);
      }.bind(this);
      this.socket.onclose = function(){
        this.socket.onopen = null;
        this.socket.onerror = null;
        this.socket.onclose = null;
        this.socket = null;
        this.state = 'closed';
        this.emit('close');
      }.bind(this);
    }.bind(this));
  }.bind(this));
};

AppChannelSignal.prototype.close = function(){
  debug('close()');
  if( this.state != 'open' ){
    return console.warn('signal not open');
  }
  this.state = 'closing';
  this.socket.close();
};

AppChannelSignal.prototype.send = function(json){
  debug('send(%j)', json);
  if( this.state != 'open' ){
    return console.warn('cannot send messages on an not-open signal');
  }

  if( typeof json != 'object' ){
    throw new Error('invalid message type. must be an object.');
  }

  // always add a sequence to the client messages so we can order them when
  // they arrive
  json.seq = this.sequence;

  var message;
  try {
    message = JSON.stringify(json);
  } catch(e){
    this.emit('error', e);
    return;
  }

  var req = new XMLHttpRequest();
  req.onerror = function(err){
    this.emit('error', err);
  }.bind(this);
  req.open('POST', PREFIX+'/'+this.room+'/'+this.peer, true);
  req.setRequestHeader('Content-Type', 'application/json');
  req.send(message);
  this.sequence++;
};

function embedScript(fn){
  // lazy load the app channel api
  if( typeof goog == 'undefined' || !goog.appengine.Channel ){
    // first try and inject the app channel script
    var script = document.createElement('script');
    script.onload = fn;
    script.onerror = fn;
    script.async = true;
    script.src = '/_ah/channel/jsapi';
    document.body.appendChild(script);
  } else {
    setTimeout(fn,1);
  }
}

function requestToken(room, fn){
  var req = new XMLHttpRequest();
  req.onload = function(){
    if( req.readyState == 4 && req.status == 200 ){
      var q;
      try {
        q = JSON.parse(req.responseText);
      } catch(e){
        fn(new Error('failed to parse the token results from:' + req.responseText));
      }
      if( q.token && q.peer ){
        fn(null, q);
      } else {
        fn(new Error('missing token and peer from results'));
      }
    }
  };
  req.onerror = fn;
  req.open('GET', PREFIX+'/'+room, true);
  req.send();
}
