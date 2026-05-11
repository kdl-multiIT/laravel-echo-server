const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Log } = require('../dist/log');
const { Server } = require('../dist/server');
const { EchoServer } = require('../dist/echo-server');
const { HttpApi } = require('../dist/api/http-api');
const { Channel } = require('../dist/channels/channel');
const { PrivateChannel } = require('../dist/channels/private-channel');
const { PresenceChannel } = require('../dist/channels/presence-channel');
const { HttpSubscriber } = require('../dist/subscribers/http-subscriber');
const { RedisSubscriber } = require('../dist/subscribers/redis-subscriber');
const { Database } = require('../dist/database/database');
const { RedisDatabase } = require('../dist/database/redis');
const { SQLiteDatabase } = require('../dist/database/sqlite');
const { Cli } = require('../dist/cli/cli');

function waitForAsyncHandlers() {
    return new Promise(resolve => setTimeout(resolve, 20));
}

async function captureConsole(callback) {
    const originalLog = console.log;
    const originalError = console.error;
    const logs = [];
    const errors = [];

    console.log = (...args) => logs.push(args);
    console.error = (...args) => errors.push(args);

    try {
        await callback(logs, errors);
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }

    return { logs, errors };
}

async function testLogClassWritesExpectedMessages() {
    const { logs } = await captureConsole(() => {
        Log.title('Title');
        Log.subtitle('Subtitle');
        Log.info('Info');
        Log.success('Success');
        Log.error('Error');
        Log.warning('Warning');
    });

    assert.strictEqual(logs.length, 6);
    assert.ok(logs.flat().some(message => String(message).includes('Title')));
    assert.ok(logs.flat().some(message => String(message).includes('Success')));
    assert.ok(logs.flat().some(message => String(message).includes('Warning')));
}

function testServerClassAuthHelpers() {
    const server = Object.create(Server.prototype);

    server.options = {
        port: 'http://localhost:6001/',
        clients: [{ appId: 'app-id', key: 'secret-key' }]
    };

    assert.strictEqual(server.getPort(), 6001);
    assert.strictEqual(server.getAppId({ params: { appId: 'app-id' } }), 'app-id');
    assert.strictEqual(server.getAppId({ params: {} }), false);
    assert.strictEqual(
        server.getAuthKey({ headers: { authorization: 'Bearer secret-key' }, url: '/apps/app-id/status' }),
        'secret-key'
    );
    assert.strictEqual(
        server.getAuthKey({ headers: {}, url: '/apps/app-id/status?auth_key=secret-key' }),
        'secret-key'
    );
    assert.strictEqual(
        server.canAccess({ params: { appId: 'app-id' }, headers: { authorization: 'Bearer secret-key' }, url: '' }),
        true
    );
    assert.strictEqual(
        server.canAccess({ params: { appId: 'app-id' }, headers: { authorization: 'Bearer wrong' }, url: '' }),
        false
    );

    const response = {
        statusCode: null,
        body: null,
        json(value) {
            this.body = value;
        }
    };

    assert.strictEqual(server.unauthorizedResponse({}, response), false);
    assert.strictEqual(response.statusCode, 403);
    assert.deepStrictEqual(response.body, { error: 'Unauthorized' });
}

async function testEchoServerClassLifecycleMethods() {
    const echo = Object.create(EchoServer.prototype);
    const calls = [];

    echo.subscribers = [
        { unsubscribe: () => Promise.resolve(calls.push('subscriber')) }
    ];
    echo.server = {
        io: {
            close: () => {
                calls.push('io');
                return Promise.resolve();
            }
        }
    };

    await captureConsole(() => echo.stop());

    assert.deepStrictEqual(calls, ['subscriber', 'io']);
    assert.deepStrictEqual(echo.subscribers, []);

    echo.subscribers = [
        { subscribe: callback => Promise.resolve(callback('channel', { event: 'Event', data: true })) }
    ];
    echo.broadcast = (channel, message) => {
        calls.push(['broadcast', channel, message]);
        return true;
    };

    await echo.listen();

    assert.deepStrictEqual(calls[calls.length - 1], ['broadcast', 'channel', { event: 'Event', data: true }]);
}

function testHttpApiClassResponsesAndCors() {
    const middleware = [];
    const express = {
        use: handler => middleware.push(handler),
        get: () => {}
    };
    const api = new HttpApi(
        { engine: { clientsCount: 3 } },
        { isPresence: () => false },
        express,
        {
            allowCors: true,
            allowOrigin: 'https://app.test',
            allowMethods: 'GET, POST',
            allowHeaders: 'Authorization'
        }
    );
    const headers = {};

    api.corsMiddleware();
    middleware[0](
        {},
        { header: (key, value) => { headers[key] = value; } },
        () => { headers.next = true; }
    );

    assert.deepStrictEqual(headers, {
        'Access-Control-Allow-Origin': 'https://app.test',
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization',
        next: true
    });

    let responseBody;
    api.getRoot({}, { send: value => { responseBody = value; } });
    assert.strictEqual(responseBody, 'OK');

    api.getStatus({}, { json: value => { responseBody = value; } });
    assert.strictEqual(responseBody.subscription_count, 3);
    assert.ok(responseBody.uptime >= 0);

    const badResponse = { statusCode: null, json: value => { responseBody = value; } };
    assert.strictEqual(api.badResponse({}, badResponse, 'Bad'), false);
    assert.strictEqual(badResponse.statusCode, 400);
    assert.deepStrictEqual(responseBody, { error: 'Bad' });
}

function testChannelClassJoinLeaveAndMatchers() {
    const joined = [];
    const left = [];
    const presenceLeaves = [];
    const channel = Object.create(Channel.prototype);
    const socket = {
        id: 'socket-1',
        rooms: new Set(),
        join: room => {
            joined.push(room);
            socket.rooms.add(room);
        },
        leave: room => {
            left.push(room);
            socket.rooms.delete(room);
        }
    };

    channel.options = { devMode: false };
    channel._privateChannels = ['private-*', 'presence-*'];
    channel._clientEvents = ['client-*'];
    channel.presence = { leave: (socket, room) => presenceLeaves.push(room) };
    channel.onJoin = (socket, room) => joined.push(`logged:${room}`);
    channel.joinPrivate = (socket, data) => joined.push(`private:${data.channel}`);

    assert.strictEqual(channel.isPrivate('private-chat'), true);
    assert.strictEqual(channel.isPrivate('public-chat'), false);
    assert.strictEqual(channel.isPresence('presence-chat'), true);
    assert.strictEqual(channel.isClientEvent('client-typing'), true);

    channel.join(socket, { channel: 'public-chat' });
    channel.join(socket, { channel: 'private-chat' });
    channel.leave(socket, 'presence-chat', 'test');

    assert.deepStrictEqual(joined, ['public-chat', 'logged:public-chat', 'private:private-chat']);
    assert.deepStrictEqual(left, ['presence-chat']);
    assert.deepStrictEqual(presenceLeaves, ['presence-chat']);
}

async function testPrivateChannelClassAuthRequests() {
    const privateChannel = new PrivateChannel({
        authEndpoint: '/broadcasting/auth',
        authHost: ['http://api.test', 'http://app.test'],
        devMode: false
    });
    const socket = {
        id: 'socket-1',
        request: {
            headers: {
                referer: 'http://app.test/dashboard',
                cookie: 'laravel_session=abc'
            }
        }
    };
    let postedOptions;

    assert.strictEqual(privateChannel.authHost(socket), 'http://app.test');
    assert.strictEqual(privateChannel.hasMatchingHost({ protocol: 'http:', host: 'app.test', hostname: 'app.test' }, 'http://app.test'), true);
    assert.deepStrictEqual(
        privateChannel.prepareHeaders(socket, { headers: {} }),
        { Cookie: 'laravel_session=abc', 'X-Requested-With': 'XMLHttpRequest' }
    );

    privateChannel.request = {
        post: (options, callback) => {
            postedOptions = options;
            callback(null, { statusCode: 200, body: '{"auth":"ok"}' });
        }
    };

    const authResponse = await privateChannel.authenticate(socket, {
        channel: 'private-chat',
        auth: { headers: { Authorization: 'Bearer token' } }
    });

    assert.strictEqual(postedOptions.url, 'http://app.test/broadcasting/auth');
    assert.deepStrictEqual(postedOptions.form, { channel_name: 'private-chat' });
    assert.deepStrictEqual(authResponse, { auth: 'ok' });

    privateChannel.request = {
        post: (options, callback) => callback(null, { statusCode: 403, body: 'Forbidden' })
    };

    await assert.rejects(
        () => privateChannel.serverRequest(socket, { headers: {}, form: { channel_name: 'private-chat' } }),
        { status: 403 }
    );
}

async function testPresenceChannelClassMembershipHelpers() {
    const store = {
        'presence-chat:members': [
            { user_id: 1, socketId: 'active-socket' },
            { user_id: 2, socketId: 'stale-socket' }
        ]
    };
    const presence = Object.create(PresenceChannel.prototype);

    presence.db = {
        get: key => Promise.resolve(store[key]),
        set: (key, value) => {
            store[key] = value;
        }
    };
    presence.io = {
        of: () => ({
            in: () => ({
                allSockets: () => Promise.resolve(new Set(['active-socket']))
            })
        })
    };

    const isMember = await presence.isMember('presence-chat', { user_id: 1 });

    assert.strictEqual(isMember, true);
    assert.deepStrictEqual(store['presence-chat:members'], [{ user_id: 1, socketId: 'active-socket' }]);
}

async function testHttpSubscriberClassHandlesBroadcasts() {
    let registeredHandler;
    const subscriber = new HttpSubscriber({
        post: (route, handler) => {
            registeredHandler = handler;
        }
    }, { devMode: false });
    const broadcasts = [];

    await captureConsole(() => subscriber.subscribe((channel, message) => broadcasts.push([channel, message])));

    assert.strictEqual(typeof registeredHandler, 'function');

    let response;
    subscriber.handleData(
        {},
        { json: value => { response = value; } },
        [Buffer.from(JSON.stringify({
            channels: ['private-chat'],
            name: 'App\\Events\\MessageSent',
            data: '{"text":"hello"}',
            socket_id: 'socket-1'
        }))],
        (channel, message) => broadcasts.push([channel, message])
    );

    assert.deepStrictEqual(broadcasts, [[
        'private-chat',
        {
            event: 'App\\Events\\MessageSent',
            data: { text: 'hello' },
            socket: 'socket-1'
        }
    ]]);
    assert.deepStrictEqual(response, { message: 'ok' });

    const badResponse = { statusCode: null, json: value => { response = value; } };
    assert.strictEqual(subscriber.badResponse({}, badResponse, 'Bad event'), false);
    assert.strictEqual(badResponse.statusCode, 400);
    assert.deepStrictEqual(response, { error: 'Bad event' });

    await subscriber.unsubscribe();
}

async function testRedisSubscriberClassSubscribeAndUnsubscribe() {
    const handlers = {};
    const subscribed = [];
    const redisSubscriber = Object.create(RedisSubscriber.prototype);
    const callbacks = [];

    redisSubscriber.options = { devMode: false };
    redisSubscriber._keyPrefix = 'prefix:';
    redisSubscriber._redis = {
        on: (event, handler) => {
            handlers[event] = handler;
        },
        psubscribe: (pattern, callback) => {
            subscribed.push(pattern);
            callback(null, 1);
        },
        disconnect: () => callbacks.push('disconnect')
    };

    await captureConsole(() => redisSubscriber.subscribe((channel, message) => callbacks.push([channel, message])));

    handlers.pmessage(null, 'prefix:private-chat', '{"event":"Event","data":{"ok":true}}');

    assert.deepStrictEqual(subscribed, ['prefix:*']);
    assert.deepStrictEqual(callbacks[0], ['private-chat', { event: 'Event', data: { ok: true } }]);

    await redisSubscriber.unsubscribe();

    assert.strictEqual(callbacks[1], 'disconnect');
}

async function testDatabaseClassesDelegateAndSerialize() {
    const database = Object.create(Database.prototype);
    const driverCalls = [];

    database.driver = {
        get: key => Promise.resolve(`value:${key}`),
        set: (key, value) => driverCalls.push([key, value])
    };

    assert.strictEqual(await database.get('key'), 'value:key');
    database.set('key', { ok: true });
    assert.deepStrictEqual(driverCalls, [['key', { ok: true }]]);

    const redisCalls = [];
    const redisDatabase = Object.create(RedisDatabase.prototype);
    redisDatabase.options = {
        databaseConfig: { publishPresence: true }
    };
    redisDatabase._redis = {
        get: key => Promise.resolve('{"stored":true}'),
        set: (key, value) => redisCalls.push(['set', key, value]),
        publish: (channel, value) => redisCalls.push(['publish', channel, value])
    };

    assert.deepStrictEqual(await redisDatabase.get('presence-chat:members'), { stored: true });
    redisDatabase.set('presence-chat:members', [{ user_id: 1 }]);

    assert.deepStrictEqual(redisCalls, [
        ['set', 'presence-chat:members', '[{"user_id":1}]'],
        ['publish', 'PresenceChannelUpdated', '{"event":{"channel":"presence-chat:members","members":[{"user_id":1}]}}']
    ]);

    const sqliteCalls = [];
    const sqliteDatabase = Object.create(SQLiteDatabase.prototype);
    sqliteDatabase._sqlite = {
        get: (sql, params, callback) => {
            sqliteCalls.push(['get', sql, params]);
            callback(null, { value: '{"stored":true}' });
        },
        run: (sql, params) => sqliteCalls.push(['run', sql, params])
    };

    assert.deepStrictEqual(await sqliteDatabase.get('cache-key'), { stored: true });
    sqliteDatabase.set('cache-key', { ok: true });

    assert.deepStrictEqual(sqliteCalls[0], ['get', 'SELECT value FROM key_value WHERE key = $key', { $key: 'cache-key' }]);
    assert.deepStrictEqual(sqliteCalls[1], [
        'run',
        'INSERT OR REPLACE INTO key_value (key, value) VALUES ($key, $value)',
        { $key: 'cache-key', $value: '{"ok":true}' }
    ]);
}

async function testCliClassHelpers() {
    const cli = Object.create(Cli.prototype);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-cli-test-'));
    const configFile = path.join(tmpDir, 'echo.json');
    const previousEnv = {
        LARAVEL_ECHO_SERVER_PORT: process.env.LARAVEL_ECHO_SERVER_PORT,
        LARAVEL_ECHO_SERVER_REDIS_HOST: process.env.LARAVEL_ECHO_SERVER_REDIS_HOST,
        REDIS_HOST_ALIAS: process.env.REDIS_HOST_ALIAS
    };

    cli.defaultOptions = {
        port: 6001,
        clients: [],
        databaseConfig: { redis: { host: 'localhost' } }
    };
    cli.envVariables = {
        LARAVEL_ECHO_SERVER_PORT: 'port',
        LARAVEL_ECHO_SERVER_REDIS_HOST: 'databaseConfig.redis.host'
    };
    cli.getRandomString = bytes => 'a'.repeat(bytes * 2);

    try {
        process.env.LARAVEL_ECHO_SERVER_PORT = '7001';
        process.env.REDIS_HOST_ALIAS = 'redis.internal';
        process.env.LARAVEL_ECHO_SERVER_REDIS_HOST = '${REDIS_HOST_ALIAS}';

        const resolved = cli.resolveEnvFileOptions({
            port: 6001,
            databaseConfig: { redis: { host: 'localhost' } }
        });

        assert.deepStrictEqual(resolved, {
            port: '7001',
            databaseConfig: { redis: { host: 'redis.internal' } }
        });

        assert.strictEqual(cli.createApiKey(), 'a'.repeat(32));
        assert.strictEqual(cli.createAppId(), 'a'.repeat(16));
        assert.strictEqual(cli.getConfigFile('echo.json', tmpDir), configFile);

        await cli.saveConfig({
            file: configFile,
            port: 7001,
            clients: [{ appId: 'app', key: 'key' }],
            ignored: true,
            databaseConfig: { redis: { host: 'redis.internal' } }
        });

        assert.deepStrictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')), {
            port: 7001,
            clients: [{ appId: 'app', key: 'key' }],
            databaseConfig: { redis: { host: 'redis.internal' } }
        });

        assert.deepStrictEqual(cli.readConfigFile(configFile).databaseConfig.redis.host, 'redis.internal');
    } finally {
        Object.keys(previousEnv).forEach(key => {
            if (previousEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previousEnv[key];
            }
        });

        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

async function run() {
    await testLogClassWritesExpectedMessages();
    testServerClassAuthHelpers();
    await testEchoServerClassLifecycleMethods();
    testHttpApiClassResponsesAndCors();
    testChannelClassJoinLeaveAndMatchers();
    await testPrivateChannelClassAuthRequests();
    await testPresenceChannelClassMembershipHelpers();
    await testHttpSubscriberClassHandlesBroadcasts();
    await testRedisSubscriberClassSubscribeAndUnsubscribe();
    await testDatabaseClassesDelegateAndSerialize();
    await testCliClassHelpers();

    console.log('All class unit tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
