# Repository Guide for Codex

## Project Shape

This is a TypeScript Laravel Echo Server implementation that builds CommonJS output into `dist/`.

- Edit source files in `src/`.
- Do not hand-edit `dist/`; it is generated and ignored by git. Run `npm run build` when runtime output needs to be refreshed.
- The active Socket.IO dependency is v4, so use `Map`/`Set` APIs for sockets and rooms.
- Run `npm test` for the Socket.IO lifecycle unit tests; it builds the project before executing tests against `dist/`.

## Class Map

- `src/echo-server.ts`: top-level lifecycle. Creates `Server`, `Channel`, subscribers, HTTP API, and registers socket event handlers.
- `src/server.ts`: Express, HTTP/HTTPS server, Socket.IO creation, API authentication, and port/protocol setup.
- `src/channels/channel.ts`: public/private/presence channel join/leave flow plus client events.
- `src/channels/private-channel.ts`: Laravel auth endpoint request handling for private and presence channels.
- `src/channels/presence-channel.ts`: presence member persistence, stale socket cleanup, join/leave notifications.
- `src/api/http-api.ts`: Pusher-like HTTP status/channel/users endpoints.
- `src/subscribers/http-subscriber.ts`: accepts HTTP broadcast events.
- `src/subscribers/redis-subscriber.ts`: subscribes to Redis broadcast events.
- `src/database/database.ts`: selects the Redis or SQLite key/value driver.
- `src/database/redis.ts`: Redis-backed presence/member storage.
- `src/database/sqlite.ts`: SQLite-backed presence/member storage.
- `src/cli/cli.ts`: interactive configuration and client management CLI.
- `src/log.ts`: console logging helpers.

## Socket.IO 4 Notes

Avoid old Socket.IO 2 data shapes:

- Use `io.sockets.sockets.get(id)` instead of `io.sockets.connected[id]`.
- Use `socket.rooms.has(room)` instead of `socket.rooms[room]`.
- Use `Array.from(socket.rooms)` instead of `Object.keys(socket.rooms)`.
- Use `io.sockets.adapter.rooms.get(room)?.size` instead of `adapter.rooms[room].length`.
- Use `io.of("/").in(room).allSockets()` when collecting active socket IDs for cleanup.

Presence cleanup must remove stale `socketId` records when a reconnect leaves old socket IDs behind, but it should not introduce a global one-user-only rule. Multiple active tabs for the same presence user remain valid unless product requirements change.
