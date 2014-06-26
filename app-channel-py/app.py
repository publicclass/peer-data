import json
import logging
import webapp2
from as_json import as_json
from uuid import uuid4

from google.appengine.api import channel
from google.appengine.ext import ndb

PREFIX = '/channel'
SEPARATOR = '=='
MIN_CLIENTS = 2
MAX_CLIENTS = 2


class Room(ndb.Model):
    clients = ndb.StringProperty(repeated=True)

    @ndb.transactional
    def add_client(self, client_id):
        if client_id in self.clients:
            logging.error('client %s already in list' % client_id)
            return

        if len(self.clients) >= MAX_CLIENTS:
            logging.warn('room is full')
            self.send(client_id, {
                'type': 'full',
                'num_clients': len(self.clients)
            })
            return

        # peers = [cid for cid in self.clients]
        self.clients.append(client_id)
        self.put()

        if len(self.clients) >= MIN_CLIENTS:
            self.send(self.clients, {
                'type': 'connected',
                'client_id': client_id,
                'num_clients': len(self.clients)
            })

    @ndb.transactional
    def remove_client(self, client_id):
        if client_id not in self.clients:
            logging.error('client %s not in room' % client_id)
            return
        self.clients.remove(client_id)
        if len(self.clients) == 0:
            self.key.delete()
        else:
            self.put()
        self.send(self.clients, {
            'type': 'disconnected',
            'client_id': client_id,
            'num_clients': len(self.clients)
        })

    def send(self, client_ids, message):
        if not isinstance(client_ids, list):
            client_ids = list([client_ids])
        if not isinstance(message, str):
            message = json.dumps(message)
        for client_id in client_ids:
            logging.info('sending "%s" to "%s"' % (message, client_id))
            channel.send_message(client_id, message)

    def stats(self):
        return {
            'num_clients': len(self.clients)
        }


class ConnectedPage(webapp2.RequestHandler):
    def post(self):
        client_id = self.request.get('from')
        room_id, user_id = parse_id(client_id)
        room = Room.get_or_insert(room_id)
        room.add_client(client_id)
        logging.info('added %s to room %s' % (user_id, room_id))
        logging.info(room.stats())


class DisconnectedPage(webapp2.RequestHandler):
    def post(self):
        client_id = self.request.get('from')
        room_id, user_id = parse_id(client_id)
        room = Room.get_by_id(room_id)
        if not room:
            logging.error('room %s does not exist' % room_id)
            return
        room.remove_client(client_id)
        logging.info('removed %s from room %s' % (user_id, room_id))
        logging.info(room.stats())


class ChannelPage(webapp2.RequestHandler):
    @as_json
    def get(self, room_id, _):
        if room_id == '':
            raise Exception('must specify room id')
        client_id = build_id(room_id, str(uuid4()))
        return {
            "token": channel.create_channel(client_id),
            "user": client_id
        }

    @as_json
    def post(self, room_id, client_id):
        if room_id == '':
            raise Exception('must specify room id')
        if client_id == '':
            raise Exception('must specify client id')

        room = Room.get_by_id(room_id)
        if not room:
            raise Exception('room does not exist')

        message = self.request.body
        logging.info(message)

        peers = [cid for cid in room.clients if not cid == client_id]
        room.send(peers, message)


def build_id(room, client_id):
    return SEPARATOR.join([room, client_id])


def parse_id(id):
    return id.split(SEPARATOR)


app = webapp2.WSGIApplication([
    (r"{}/?([^/]*)/?([^/]*)".format(PREFIX), ChannelPage),
    ("/_ah/channel/connected/", ConnectedPage),
    ("/_ah/channel/disconnected/", DisconnectedPage)
], debug=True)
