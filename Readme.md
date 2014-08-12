# peer-data

A wrapper for WebRTC which focuses on data-only. So no streams just a simple
and reliable API for peer-to-peer data channels, both reliable and unreliable.

## Example

```
var signal = new HTTPPollingSignal({room: 'test'});

var peers = new PeerData(signal);
peers.on('open', function(){ console.log('peer data open') });
peers.on('peer connected', function(){ console.log('peer data connected') });
peers.on('peer disconnected', function(){ console.log('peer data disconnected') });
peers.on('close', function(){ console.log('peer data close') });

var channel = peers.channel('reliable');
channel.on('open', function(e){ console.log('reliable open'); });
channel.on('message', function(e){ console.log('reliable message'); });
channel.on('close', function(e){ console.log('reliable close'); });

var channel = peers.channel('unreliable', {maxRetransmits: 10});
channel.on('open', function(e){ console.log('unreliable open'); });
channel.on('message', function(e){ console.log('unreliable message'); });
channel.on('close', function(e){ console.log('unreliable close'); });

```

## API

### new Signal(options)

Signals are responsible for the initial handshake and peer presence (connected,
disconnected).

Options:
- `room`

Events:
- `open` {peer:String} - the peer id assigned in room
- `message` {from:String, data:JSON}
- `close`

### Signal#send(message)

Broadcasts a message to all clients connected to the signal.

### Signal#close()

Closes the connection to the signal. Will also disconnect from any peer data
connections using this signal.

### new PeerData(signal)

A peer data instance has N connected peers and M channels. Will call `open()` on
the signal if it's not already open.

Events:
- `open`
- `close`
- `peer connected` `{peer:String}`
- `peer disconnected` `{peer:String}`

### PeerData#peers

A list of Peer instances.


### PeerData#close()

Closes the connection to other peers. Will also close any channel connections
using this peer data connection. Will not close the signal, so it's possible
to create a new PeerData instance on the signal after it's closed.


### PeerData#channel(label, [options]) -> PeerChannel

Get or create a PeerChannel instance.

Options:
http://www.w3.org/TR/webrtc/#idl-def-RTCDataChannelInit

### new PeerChannel(peerData, label, options)

Simply makes a DataChannel which connects to each peer.

Events:
- `open`
- `close`
- `message` {from:String, type:['json', 'binary', 'string'], data:Dynamic}


### PeerChannel#send(message)

Send a message to all peers connected to the channel. Any messages sent before
a peer was connected will not be received.


### PeerChannel#close()

Closes a peers connection the channels. Does not


### new Peer(peerData, id)

A peer has a peer id and a PeerConnection and for each created PeerChannel it
will also have a DataChannel.

Peers will be created and removed upon connection/disconnection
