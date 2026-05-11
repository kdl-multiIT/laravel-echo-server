const assert = require('assert');

const { EchoServer } = require('../dist/echo-server');
const { HttpApi } = require('../dist/api/http-api');
const { Channel } = require('../dist/channels/channel');
const { PresenceChannel } = require('../dist/channels/presence-channel');

function waitForAsyncHandlers() {
    return new Promise(resolve => setTimeout(resolve, 20));
}

function makePresenceChannel(store, activeSocketIds, events) {
    const presence = Object.create(PresenceChannel.prototype);

    presence.options = { devMode: false };
    presence.db = {
        get: key => Promise.resolve(store[key]),
        set: (key, value) => {
            store[key] = value;
        }
    };
    presence.io = {
        of: () => ({
            in: () => ({
                allSockets: () => Promise.resolve(new Set(activeSocketIds))
            })
        }),
        to: room => ({
            emit: (...args) => events.push(['to', room, args])
        })
    };

    return presence;
}

async function testPresenceReconnectReplacesStaleSocketId() {
    const store = {
        'presence-chat:members': [
            { user_id: 1, user_info: { name: 'Ada' }, socketId: 'old-socket' }
        ]
    };
    const events = [];
    const presence = makePresenceChannel(store, ['new-socket'], events);
    const socket = {
        id: 'new-socket',
        broadcast: {
            to: room => ({
                emit: (...args) => events.push(['broadcast', room, args])
            })
        }
    };

    presence.join(socket, 'presence-chat', { user_id: 1, user_info: { name: 'Ada' } });

    await waitForAsyncHandlers();

    assert.deepStrictEqual(
        store['presence-chat:members'],
        [{ user_id: 1, user_info: { name: 'Ada' }, socketId: 'new-socket' }]
    );
    assert.ok(
        events.some(event => event[0] === 'to' && event[1] === 'new-socket'),
        'expected presence:subscribed to be emitted to the new socket'
    );
}

async function testPresenceLeaveIgnoresMissingMember() {
    const store = { 'presence-chat:members': [] };
    const events = [];
    const presence = makePresenceChannel(store, [], events);

    presence.leave({ id: 'missing-socket' }, 'presence-chat');

    await waitForAsyncHandlers();

    assert.deepStrictEqual(store['presence-chat:members'], []);
    assert.deepStrictEqual(events, []);
}

function testDisconnectingLeavesJoinedRoomsOnly() {
    const leftRooms = [];
    const echo = Object.create(EchoServer.prototype);
    const socket = {
        id: 'socket-1',
        rooms: new Set(['socket-1', 'presence-chat', 'private-chat']),
        on: (event, callback) => {
            assert.strictEqual(event, 'disconnecting');
            callback('transport close');
        }
    };

    echo.channel = {
        leave: (socket, room, reason) => leftRooms.push([room, reason])
    };

    echo.onDisconnecting(socket);

    assert.deepStrictEqual(leftRooms, [
        ['presence-chat', 'transport close'],
        ['private-chat', 'transport close']
    ]);
}

function testHttpApiUsesSocketIo4RoomMaps() {
    const responses = [];
    const api = new HttpApi({
        engine: { clientsCount: 2 },
        sockets: {
            adapter: {
                rooms: new Map([
                    ['socket-1', new Set(['socket-1'])],
                    ['public-room', new Set(['socket-1', 'socket-2'])]
                ]),
                sids: new Map([
                    ['socket-1', new Set(['socket-1', 'public-room'])]
                ])
            }
        }
    }, { isPresence: () => false }, null, {});

    api.getChannels({ url: '/apps/app-id/channels' }, {
        json: value => responses.push(value)
    });
    api.getChannel({ params: { channelName: 'public-room' } }, {
        json: value => responses.push(value)
    });

    assert.deepStrictEqual(responses[0], {
        channels: {
            'public-room': {
                subscription_count: 2,
                occupied: true
            }
        }
    });
    assert.deepStrictEqual(responses[1], {
        subscription_count: 2,
        occupied: true
    });
}

function testBroadcastToOthersUsesOriginSocket() {
    const emitted = [];
    const originSocket = {
        broadcast: {
            to: room => ({
                emit: (...args) => emitted.push([room, args])
            })
        }
    };
    const echo = Object.create(EchoServer.prototype);

    echo.server = {
        io: {
            sockets: {
                sockets: new Map([['socket-1', originSocket]])
            },
            to: () => ({
                emit: () => {
                    throw new Error('toAll should not be used when the origin socket exists');
                }
            })
        }
    };

    echo.broadcast('private-room', {
        event: 'App\\Events\\MessageSent',
        data: { ok: true },
        socket: 'socket-1'
    });

    assert.deepStrictEqual(emitted, [[
        'private-room',
        ['App\\Events\\MessageSent', 'private-room', { ok: true }]
    ]]);
}

function testChannelMembershipAndClientEventUseSocketIo4Rooms() {
    const emitted = [];
    const channel = Object.create(Channel.prototype);
    const socket = {
        id: 'socket-1',
        rooms: new Set(['private-chat']),
        broadcast: {
            to: room => ({
                emit: (...args) => emitted.push([room, args])
            })
        }
    };

    channel._privateChannels = ['private-*', 'presence-*'];
    channel._clientEvents = ['client-*'];

    assert.strictEqual(channel.isInChannel(socket, 'private-chat'), true);
    assert.strictEqual(channel.isInChannel(socket, 'private-other'), false);

    channel.clientEvent(socket, JSON.stringify({
        event: 'client-typing',
        channel: 'private-chat',
        data: { typing: true }
    }));

    assert.deepStrictEqual(emitted, [[
        'private-chat',
        ['client-typing', 'private-chat', { typing: true }]
    ]]);
}

async function run() {
    await testPresenceReconnectReplacesStaleSocketId();
    await testPresenceLeaveIgnoresMissingMember();
    testDisconnectingLeavesJoinedRoomsOnly();
    testHttpApiUsesSocketIo4RoomMaps();
    testBroadcastToOthersUsesOriginSocket();
    testChannelMembershipAndClientEventUseSocketIo4Rooms();

    console.log('Socket.IO 4 lifecycle unit tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
