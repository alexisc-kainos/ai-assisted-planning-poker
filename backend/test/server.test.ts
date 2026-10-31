import { once } from 'node:events';
import { connect as connectTcp } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import type { AppServer } from '../src/server.js';
import { connect, rejectedStatus, startServer, type Message } from './helpers.js';

let app: AppServer | undefined;
let port = 0;

async function start(overrides: Partial<Config> = {}) {
  ({ app, port } = await startServer({ shutdownGraceMs: 500, ...overrides }));
}

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

const ROOM = 'xk29-4plm';
const roomStatus = async (id: string, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/rooms/${id}`, { headers });

describe('create and join handshake', () => {
  it('makes the first connection host and sends welcome before state', async () => {
    await start();
    const alice = await connect(port, { room: ROOM, name: 'Alice', avatar: 'capybara', deck: 'fibonacci' });

    const [first, second] = [await alice.next(), await alice.next()];
    expect(first).toEqual({ type: 'welcome', userId: expect.stringMatching(/^user-/) });
    expect(second).toEqual({
      type: 'state',
      hostId: first.userId,
      revealed: false,
      deck: 'fibonacci',
      users: [{ id: first.userId, name: 'Alice', avatar: 'capybara', hasVoted: false }],
      votes: null,
    });
  });

  it('broadcasts the full roster to everyone when someone joins, in join order', async () => {
    await start();
    const alice = await connect(port, { room: ROOM, name: 'Alice', avatar: 'cat' });
    const { userId: aliceId } = await alice.next('welcome');
    await alice.next('state');

    const bob = await connect(port, { room: ROOM, name: 'Bob', avatar: 'dog', deck: 'tshirt' });
    const { userId: bobId } = await bob.next('welcome');

    const expected = {
      hostId: aliceId,
      users: [
        { id: aliceId, name: 'Alice', avatar: 'cat', hasVoted: false },
        { id: bobId, name: 'Bob', avatar: 'dog', hasVoted: false },
      ],
    };
    const [aliceView, bobView] = [await alice.next('state'), await bob.next('state')];
    expect(aliceView).toMatchObject(expected);
    expect(bobView).toMatchObject(expected);
    expect(bobView).not.toHaveProperty('deck');
  });

  it('allows duplicate names and duplicate avatars', async () => {
    await start();
    const first = await connect(port, { room: ROOM, name: 'Sam', avatar: 'penguin' });
    await first.next('state');
    const second = await connect(port, { room: ROOM, name: 'Sam', avatar: 'penguin' });
    await second.next('welcome');

    const state: Message = await second.next('state');
    expect(state.users).toHaveLength(2);
    expect(state.users.map((u: Message) => [u.name, u.avatar])).toEqual([
      ['Sam', 'penguin'],
      ['Sam', 'penguin'],
    ]);
    expect(state.users[0].id).not.toEqual(state.users[1].id);
  });

  it('omits avatar when none is provided and trims the name', async () => {
    await start();
    const client = await connect(port, { room: ROOM, name: '  Dana  ', avatar: '  ' });
    const state = await client.next('state');
    expect(state.users[0]).toEqual({ id: expect.any(String), name: 'Dana', hasVoted: false });
  });

  it.each([
    ['missing room', { name: 'Alice' }],
    ['invalid room', { room: 'NOPE', name: 'Alice' }],
    ['missing name', { room: ROOM }],
    ['blank name', { room: ROOM, name: '   ' }],
    ['name over 32 chars', { room: ROOM, name: 'x'.repeat(33) }],
    ['deck over 32 chars', { room: ROOM, name: 'Alice', deck: 'd'.repeat(33) }],
    ['avatar over 32 chars', { room: ROOM, name: 'Alice', avatar: 'a'.repeat(33) }],
  ])('rejects the upgrade with 400 for %s', async (_label, params) => {
    await start();
    expect(await rejectedStatus(port, params as Record<string, string>)).toBe(400);
  });
});

describe('room capacity', () => {
  it('rejects joiners with 403 once the room is full and reports it via /rooms/:id', async () => {
    await start({ maxRoomUsers: 2 });
    const a = await connect(port, { room: ROOM, name: 'A' });
    await a.next('state');
    expect(await (await roomStatus(ROOM)).json()).toEqual({ exists: true, userCount: 1, capacity: 2, full: false });

    const b = await connect(port, { room: ROOM, name: 'B' });
    await b.next('state');
    expect(await (await roomStatus(ROOM)).json()).toEqual({ exists: true, userCount: 2, capacity: 2, full: true });

    expect(await rejectedStatus(port, { room: ROOM, name: 'C' })).toBe(403);
  });

  it('frees a place when someone leaves', async () => {
    await start({ maxRoomUsers: 1 });
    const a = await connect(port, { room: ROOM, name: 'A' });
    await a.next('state');
    await a.close();
    const b = await connect(port, { room: ROOM, name: 'B' });
    expect((await b.next('state')).users).toHaveLength(1);
  });
});

describe('leaving and host promotion', () => {
  it('promotes the oldest remaining user when the host leaves', async () => {
    await start();
    const alice = await connect(port, { room: ROOM, name: 'Alice' });
    await alice.next('state');
    const bob = await connect(port, { room: ROOM, name: 'Bob' });
    const { userId: bobId } = await bob.next('welcome');
    const carol = await connect(port, { room: ROOM, name: 'Carol' });
    await carol.next('welcome');
    await carol.settledState();

    await alice.close();
    const state = await carol.next('state');
    expect(state.hostId).toBe(bobId);
    expect(state.users.map((u: Message) => u.name)).toEqual(['Bob', 'Carol']);
  });

  it('discards the room when the last user leaves', async () => {
    await start();
    const alice = await connect(port, { room: ROOM, name: 'Alice' });
    await alice.next('state');
    await alice.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await (await roomStatus(ROOM)).json()).toMatchObject({ exists: false, userCount: 0 });
  });

  it('treats a reconnect as a new user who does not regain host', async () => {
    await start();
    const alice = await connect(port, { room: ROOM, name: 'Alice' });
    const { userId: oldId } = await alice.next('welcome');
    const bob = await connect(port, { room: ROOM, name: 'Bob' });
    const { userId: bobId } = await bob.next('welcome');
    await bob.settledState();
    await alice.close();
    await bob.next('state');

    const again = await connect(port, { room: ROOM, name: 'Alice' });
    const { userId: newId } = await again.next('welcome');
    const state = await again.next('state');
    expect(newId).not.toBe(oldId);
    expect(state.hostId).toBe(bobId);
    expect(state.users.map((u: Message) => u.id)).toEqual([bobId, newId]);
  });
});

describe('HTTP routes', () => {
  it('GET /health returns ok without CORS headers', async () => {
    await start();
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'http://localhost:5173' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('GET /rooms/:id returns 400 for an invalid id', async () => {
    await start();
    const res = await roomStatus('NOT_VALID');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid room id' });
  });

  it('GET /rooms/:id reports a room that does not exist yet', async () => {
    await start();
    expect(await (await roomStatus(ROOM)).json()).toEqual({ exists: false, userCount: 0, capacity: 50, full: false });
  });

  it('echoes allowed origins only', async () => {
    await start({ allowedOrigins: ['https://team.github.io'] });
    const allowed = await roomStatus(ROOM, { Origin: 'https://team.github.io' });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://team.github.io');

    const denied = await roomStatus(ROOM, { Origin: 'https://evil.example' });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers CORS preflight with 204', async () => {
    await start({ allowedOrigins: ['https://team.github.io'] });
    const res = await fetch(`http://127.0.0.1:${port}/rooms/${ROOM}`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://team.github.io', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://team.github.io');
  });

  it('returns 404 for unknown routes', async () => {
    await start();
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });

  it.each([
    ['HTTP request', 'GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    [
      'WebSocket upgrade',
      'GET //[ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
        'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
    ],
  ])('answers a malformed URL in an %s with 400 and stays up', async (_label, raw) => {
    await start();
    const socket = connectTcp(port, '127.0.0.1');
    socket.end(raw);
    let response = '';
    socket.on('data', (chunk) => (response += chunk));
    await once(socket, 'close');
    expect(response).toMatch(/^HTTP\/1\.1 400/);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  });
});

describe('voting, reveal and reset', () => {
  async function twoUsers() {
    await start();
    const host = await connect(port, { room: ROOM, name: 'Host' });
    const { userId: hostId } = await host.next('welcome');
    const guest = await connect(port, { room: ROOM, name: 'Guest' });
    const { userId: guestId } = await guest.next('welcome');
    await host.settledState();
    await guest.settledState();
    return { host, guest, hostId, guestId };
  }

  it('shows who voted without leaking values, then reveals them', async () => {
    const { host, guest, hostId, guestId } = await twoUsers();

    guest.send({ type: 'vote', value: '5' });
    const afterVote = await host.next('state');
    expect(afterVote.votes).toBeNull();
    expect(afterVote.users.find((u: Message) => u.id === guestId).hasVoted).toBe(true);
    await guest.next('state');

    guest.send({ type: 'reveal' });
    expect(await guest.next('error')).toEqual({ type: 'error', message: 'Only the host can reveal votes' });

    host.send({ type: 'reveal' });
    const revealed = await guest.next('state');
    expect(revealed).toMatchObject({ revealed: true, votes: { [guestId]: '5' } });
    expect(revealed.votes).not.toHaveProperty(hostId);
    await host.next('state');

    guest.send({ type: 'vote', value: '8' });
    expect((await guest.next('error')).message).toBe('Voting is locked until reset');
    host.send({ type: 'reveal' });
    expect((await host.next('error')).message).toBe('Votes are already revealed');

    guest.send({ type: 'reset' });
    expect((await guest.next('error')).message).toBe('Only the host can reset votes');
    host.send({ type: 'reset' });
    const reset = await guest.next('state');
    expect(reset).toMatchObject({ revealed: false, votes: null });
    expect(reset.users.every((u: Message) => !u.hasVoted)).toBe(true);
    await host.next('state');

    host.send({ type: 'reset' });
    expect((await host.next('error')).message).toBe('Votes are already reset');
  });

  it('removes a disconnected voter from the vote map', async () => {
    const { host, guest, guestId } = await twoUsers();
    guest.send({ type: 'vote', value: '3' });
    await host.next('state');
    await guest.close();
    await host.next('state');
    host.send({ type: 'reveal' });
    const state = await host.next('state');
    expect(state.votes).toEqual({});
    expect(state.users.map((u: Message) => u.id)).not.toContain(guestId);
  });

  it('rejects bad messages without broadcasting state', async () => {
    const { host, guest } = await twoUsers();
    host.send('not json');
    expect((await host.next('error')).message).toBe('Malformed message');
    host.send({ type: 'shout' });
    expect((await host.next('error')).message).toBe('Unknown message type');
    host.send({ type: 'vote', value: 5 });
    expect((await host.next('error')).message).toBe('Invalid vote message');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.messages).toEqual([]);
    expect(guest.messages).toEqual([]);
  });
});

describe('rate limiting', () => {
  it('rejects messages over the limit and keeps the socket open', async () => {
    await start({ rateLimitMax: 2, rateLimitWindowMs: 60_000 });
    const client = await connect(port, { room: ROOM, name: 'Spammy' });
    await client.next('state');

    client.send({ type: 'vote', value: '1' });
    client.send({ type: 'vote', value: '2' });
    client.send({ type: 'vote', value: '3' });
    await client.next('state');
    await client.next('state');
    expect(await client.next('error')).toEqual({ type: 'error', message: 'Rate limit exceeded' });
    expect(client.ws.readyState).toBe(client.ws.OPEN);
  });
});

describe('heartbeat and shutdown', () => {
  it('closes sockets that do not answer pings with 1011', async () => {
    await start({ heartbeatIntervalMs: 50, heartbeatTimeoutMs: 50 });
    const client = await connect(port, { room: ROOM, name: 'Sleepy' }, { autoPong: false });
    const [code] = await once(client.ws, 'close');
    expect(code).toBe(1011);
  });

  it('closes every socket with 1001 server_shutdown', async () => {
    await start();
    const client = await connect(port, { room: ROOM, name: 'Alice' });
    const closed = once(client.ws, 'close');
    const stopping = app!.shutdown();
    const [code, reason] = await closed;
    expect(code).toBe(1001);
    expect(reason.toString()).toBe('server_shutdown');
    await stopping;
    app = undefined;
  });
});
