import json
import logging
import webapp2
from datetime import datetime
from as_json import as_json, json_extras
from uuid import uuid4

from google.appengine.api import channel, memcache

PREFIX = '/channel'
SEPARATOR = '=='
MIN_CLIENTS = 2
MAX_CLIENTS = 4

# rtc:appchan:{room_id}:clients = set()
# rtc:appchan:{room_id}:{client_id}:touched = datetime.utcnow()

CLIENTS = 'rtc:appchan:%(room_id)s:client_ids'
CLIENT_TOUCHED = 'rtc:appchan:%(room_id)s:%(client_id)s:touched'


class Room():

    def __init__(self, room_id):
        self.room_id = room_id

    def clients(self):
        return memcache.get(CLIENTS % {'room_id': self.room_id}) or set()

    def add_client(self, client_id):
        peers = self.clients()
        success = append(CLIENTS % ({'room_id': self.room_id}), client_id)
        if success:
            memcache.set(CLIENT_TOUCHED % {
                'room_id': self.room_id,
                'client_id': client_id
            }, datetime.utcnow())

            # send a connected event to the new peer for each of the currently
            # connected clients
            for cid in peers:
                self.send(client_id, {
                    'type': 'connected',
                    'peer': cid,
                    'clients': peers
                })

            peers.add(client_id)

            # then send a connected event to each peer for the new client
            self.send(peers, {
                'type': 'connected',
                'peer': client_id,
                'clients': peers
            })

    def remove_client(self, client_id):
        success = remove(CLIENTS % ({'room_id': self.room_id}), client_id)
        if success:
            clients = self.clients()
            self.send(clients, {
                'type': 'disconnected',
                'peer': client_id,
                'clients': clients
            })

    def send(self, client_ids, message, verify=False):
        if not isinstance(client_ids, (list, set)):
            client_ids = list([client_ids])
        if not isinstance(message, str):
            message = json.dumps(message, default=json_extras)
        for client_id in client_ids:
            if verify and client_id not in self.clients():
                logging.warn('trying to send to a client not in the room')
            else:
                logging.info('sending "%s" to "%s"' % (message, client_id))
                channel.send_message(client_id, message)

    def stats(self):
        return {
            'num_clients': len(self.clients())
        }


class ConnectedPage(webapp2.RequestHandler):
    def post(self):
        client_id = self.request.get('from')
        room_id, user_id = parse_id(client_id)
        room = Room(room_id)
        room.add_client(client_id)
        logging.info('added %s to room %s' % (user_id, room_id))
        logging.info(room.stats())


class DisconnectedPage(webapp2.RequestHandler):
    def post(self):
        client_id = self.request.get('from')
        room_id, user_id = parse_id(client_id)
        room = Room(room_id)
        room.remove_client(client_id)
        logging.info('removed %s from room %s' % (user_id, room_id))
        logging.info(room.stats())


class ChannelPage(webapp2.RequestHandler):
    @as_json
    def get(self, room_id, _, __):
        if room_id == '':
            raise Exception('must specify room id')
        client_id = build_id(room_id, str(uuid4()))
        return {
            'token': channel.create_channel(client_id),
            'peer': client_id
        }

    @as_json
    def post(self, room_id, from_id, to_id):
        if room_id == '':
            raise Exception('must specify room id')
        if from_id == '':
            raise Exception('must specify a "from" client id')

        room = Room(room_id)

        message = self.request.body
        logging.info(message)

        # retry message for full rooms
        if from_id not in room.clients() and message == '{"type":"reconnect"}':
            room.add_client(from_id)
            return

        if not to_id or to_id == '':
            peers = [cid for cid in room.clients() if not cid == from_id]
            room.send(peers, {
                'from': from_id,
                'data': message
            }, True)
        else:
            room.send(to_id, {
                'from': from_id,
                'data': message
            }, True)


def build_id(room, client_id):
    return SEPARATOR.join([room, client_id])


def parse_id(id):
    return id.split(SEPARATOR)


def append(key, value, time=0, retries=5):
    # logging.info('append("%s", %s)' % (key, value))
    client = memcache.Client()
    attempt = 1
    while attempt <= retries:  # retry loop
        # logging.info('attempt %s/%s' % (attempt, retries))
        current_set = client.gets(key)
        # logging.info('current set: %s' % current_set)
        if not current_set:  # create new set
            client.set(key, set([value]), time=time)
            return True  # success!

        current_set.add(value)
        if client.cas(key, current_set, time=time):
            return True  # success!
        attempt += 1

    logging.error('failed to append %s to %s' % (value, key))
    return False


def remove(key, value, time=0, retries=5):
    # logging.info('remove(%s, %s)' % (key, value))
    client = memcache.Client()
    while retries > 0:  # retry loop
        retries -= 1
        current_set = client.gets(key) or set()
        current_set.discard(value)
        if client.cas(key, current_set, time=time):
            return True  # success!
    logging.error('failed to remove %s from %s' % (value, key))
    return False


def get_and_empty(key, time=0, retries=5):
    # logging.info('get_and_empty(%s)' % (key))
    client = memcache.Client()
    while retries > 0:  # retry loop
        retries -= 1
        current_set = client.gets(key)
        if client.cas(key, set(), time=time):
            if len(current_set) > 0:
                logging.info('emptied %s items from %s' %
                             (len(current_set), key))
            return current_set
    logging.error('failed to get_and_empty %s' % (key))
    return None


app = webapp2.WSGIApplication([
    (r"{}/?([^/]*)/?([^/]*)/?([^/]*)".format(PREFIX), ChannelPage),
    ("/_ah/channel/connected/", ConnectedPage),
    ("/_ah/channel/disconnected/", DisconnectedPage)
], debug=True)
