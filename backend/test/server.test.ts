import { once } from 'node:events';
import { connect as connectTcp } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import type { AppServer } from '../src/server.js';
import { connect, rejectedStatus, startServer, type Message, type TestClient } from './helpers.js';

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
const vote = (value: string, round = 0) => ({ type: 'vote', value, round });
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
      tickets: [],
      activeTicketId: null,
      round: 0,
      users: [{ id: first.userId, name: 'Alice', avatar: 'capybara', hasVoted: false, spectating: false }],
      votes: null,
      myVote: null,
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
        { id: aliceId, name: 'Alice', avatar: 'cat', hasVoted: false, spectating: false },
        { id: bobId, name: 'Bob', avatar: 'dog', hasVoted: false, spectating: false },
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
    expect(state.users[0]).toEqual({ id: expect.any(String), name: 'Dana', hasVoted: false, spectating: false });
  });

  it('joins as a spectator with spectating=1', async () => {
    await start();
    const client = await connect(port, { room: ROOM, name: 'Eve', spectating: '1' });
    const state = await client.next('state');
    expect(state.users[0]).toMatchObject({ name: 'Eve', spectating: true });
  });

  it.each([
    ['missing room', { name: 'Alice' }],
    ['invalid room', { room: 'NOPE', name: 'Alice' }],
    ['missing name', { room: ROOM }],
    ['blank name', { room: ROOM, name: '   ' }],
    ['name over 32 chars', { room: ROOM, name: 'x'.repeat(33) }],
    ['deck over 32 chars', { room: ROOM, name: 'Alice', deck: 'd'.repeat(33) }],
    ['avatar over 32 chars', { room: ROOM, name: 'Alice', avatar: 'a'.repeat(33) }],
    ['invalid spectating', { room: ROOM, name: 'Alice', spectating: 'true' }],
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

    guest.send(vote('5'));
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

    guest.send(vote('8'));
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

    guest.send(vote('8'));
    expect((await guest.next('error')).message).toBe('Vote was for a previous round');
    guest.send(vote('8', reset.round));
    expect((await guest.next('state')).myVote).toBe('8');
  });

  it('removes a disconnected voter from the vote map', async () => {
    const { host, guest, guestId } = await twoUsers();
    guest.send(vote('3'));
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
    host.send({ type: 'vote', value: 5, round: 0 });
    expect((await host.next('error')).message).toBe('Invalid vote message');
    host.send({ type: 'vote', value: '5' });
    expect((await host.next('error')).message).toBe('Invalid vote message');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.messages).toEqual([]);
    expect(guest.messages).toEqual([]);
  });

  it.each(['1', '2', '3', '5', '8', '13', '20', '☕'])('accepts the story-deck vote %s', async (value) => {
    const { host, guest, guestId } = await twoUsers();
    guest.send(vote(value));
    await host.next('state');
    host.send({ type: 'reveal' });
    expect((await host.next('state')).votes).toEqual({ [guestId]: value });
    await guest.settledState();
  });

  it('broadcasts a vote as hasVoted only, telling just the voter their own value', async () => {
    const { host, guest, guestId } = await twoUsers();
    guest.send(vote('☕'));
    const [hostView, guestView] = [await host.next('state'), await guest.next('state')];
    for (const view of [hostView, guestView]) {
      expect(view.votes).toBeNull();
      expect(view.users.find((u: Message) => u.id === guestId).hasVoted).toBe(true);
    }
    expect(JSON.stringify(hostView)).not.toContain('☕');
    expect(hostView.myVote).toBeNull();
    expect(guestView.myVote).toBe('☕');
  });

  it('keeps the accepted vote as myVote when a re-vote is rejected', async () => {
    await start({ rateLimitMax: 2, rateLimitWindowMs: 60_000 });
    const client = await connect(port, { room: ROOM, name: 'Voter' });
    await client.next('state');
    client.send(vote('5'));
    expect((await client.next('state')).myVote).toBe('5');
    client.send(vote('8'));
    expect((await client.next('state')).myVote).toBe('8');
    client.send(vote('13'));
    expect((await client.next('error')).message).toBe('Rate limit exceeded');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.messages.filter((m) => m.type === 'state')).toEqual([]);
  });

  it('clears myVote on reset', async () => {
    const { host, guest } = await twoUsers();
    guest.send(vote('3'));
    await host.next('state');
    expect((await guest.next('state')).myVote).toBe('3');
    host.send({ type: 'reset' });
    expect((await guest.next('state')).myVote).toBeNull();
  });

  it('keeps only the latest vote when a participant changes their mind', async () => {
    const { host, guest, guestId } = await twoUsers();
    for (const value of ['3', '8', '13']) {
      guest.send(vote(value));
      expect((await host.next('state')).votes).toBeNull();
    }
    host.send({ type: 'reveal' });
    expect((await host.next('state')).votes).toEqual({ [guestId]: '13' });
  });

  it('does not require anyone to vote', async () => {
    const { host, guest } = await twoUsers();
    host.send({ type: 'addTicket', ticket: { type: 'story', content: 'Login page' } });
    expect((await guest.next('state')).users.every((u: Message) => !u.hasVoted)).toBe(true);
    await host.next('state');
    host.send({ type: 'reveal' });
    expect((await guest.next('state')).votes).toEqual({});
  });

  it('accepts a vote before any ticket is active', async () => {
    const { host, guest, guestId } = await twoUsers();
    guest.send(vote('5'));
    const state = await host.next('state');
    expect(state.activeTicketId).toBeNull();
    expect(state.users.find((u: Message) => u.id === guestId).hasVoted).toBe(true);
  });
});

describe('ticket list', () => {
  let round = 0;

  async function twoUsers() {
    round = 0;
    await start();
    const host = await connect(port, { room: ROOM, name: 'Host' });
    const { userId: hostId } = await host.next('welcome');
    const guest = await connect(port, { room: ROOM, name: 'Guest', avatar: 'penguin' });
    const { userId: guestId } = await guest.next('welcome');
    await host.settledState();
    await guest.settledState();
    return { host, guest, hostId, guestId };
  }

  const addTicket = (content: unknown, type: unknown = 'story') => ({ type: 'addTicket', ticket: { type, content } });

  async function act(sender: TestClient, others: TestClient[], message: unknown): Promise<Message> {
    sender.send(message);
    const state = await sender.next('state');
    for (const other of others) await other.next('state');
    round = state.round;
    return state;
  }

  async function addTickets(host: TestClient, guest: TestClient, ...contents: string[]): Promise<string[]> {
    let state: Message = {};
    for (const content of contents) state = await act(host, [guest], addTicket(content));
    return state.tickets.map((t: Message) => t.id);
  }

  it('lets the host add trimmed tickets in order without activating them, visible to everyone', async () => {
    const { host, guest } = await twoUsers();
    host.send(addTicket('  As a user\nI want to log in  '));
    const guestView = await guest.next('state');
    await host.next('state');
    expect(guestView.tickets).toEqual([
      { id: expect.stringMatching(/^ticket-/), type: 'story', content: 'As a user\nI want to log in', result: null },
    ]);
    expect(guestView.activeTicketId).toBeNull();

    await addTickets(host, guest, 'Logout', 'Logout');
    const late = await connect(port, { room: ROOM, name: 'Late' });
    const lateView = await late.next('state');
    expect(lateView.tickets.map((t: Message) => t.content)).toEqual(['As a user\nI want to log in', 'Logout', 'Logout']);
    expect(new Set(lateView.tickets.map((t: Message) => t.id)).size).toBe(3);
  });

  it.each([
    ['add', 'addTicket', 'Only the host can add tickets'],
    ['edit', 'editTicket', 'Only the host can edit tickets'],
    ['remove', 'removeTicket', 'Only the host can remove tickets'],
    ['select', 'selectTicket', 'Only the host can select tickets'],
  ])('rejects a non-host trying to %s a ticket without broadcasting', async (_label, type, error) => {
    const { host, guest } = await twoUsers();
    const [ticketId] = await addTickets(host, guest, 'Login');
    guest.send({ type, ticketId, content: 'Sneaky', ticket: { type: 'story', content: 'Sneaky' } });
    expect(await guest.next('error')).toEqual({ type: 'error', message: error });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.messages).toEqual([]);
  });

  it.each([
    ['no ticket', { type: 'addTicket' }],
    ['unknown type', addTicket('Login', 'epic')],
    ['blank content', addTicket('   ')],
    ['content over 500 chars', addTicket('x'.repeat(501))],
  ])('rejects %s with Invalid addTicket message', async (_label, message) => {
    const { host } = await twoUsers();
    host.send(message);
    expect((await host.next('error')).message).toBe('Invalid addTicket message');
  });

  it('accepts content of exactly 500 chars', async () => {
    const { host } = await twoUsers();
    host.send(addTicket('x'.repeat(500)));
    expect((await host.next('state')).tickets[0].content).toHaveLength(500);
  });

  it('allows 10 tickets, blocks the 11th, and frees a slot on removal', async () => {
    const { host, guest } = await twoUsers();
    const ids = await addTickets(host, guest, ...Array.from({ length: 10 }, (_, i) => `Ticket ${i + 1}`));
    expect(ids).toHaveLength(10);

    host.send(addTicket('Ticket 11'));
    expect((await host.next('error')).message).toBe('A room can have at most 10 tickets');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(guest.messages).toEqual([]);

    await act(host, [guest], { type: 'removeTicket', ticketId: ids[0] });
    const state = await act(host, [guest], addTicket('Ticket 11'));
    expect(state.tickets).toHaveLength(10);
    expect(state.tickets.at(-1).content).toBe('Ticket 11');
  });

  it('switches to any ticket with a fresh round, rejecting the already-active or unknown ones', async () => {
    const { host, guest } = await twoUsers();
    const [first, , third] = await addTickets(host, guest, 'One', 'Two', 'Three');

    let state = await act(host, [guest], { type: 'selectTicket', ticketId: third });
    expect(state.activeTicketId).toBe(third);

    await act(guest, [host], vote('5', round));
    host.send({ type: 'selectTicket', ticketId: third });
    expect((await host.next('error')).message).toBe('Ticket is already active');
    host.send({ type: 'selectTicket', ticketId: 'ticket-missing' });
    expect((await host.next('error')).message).toBe('Ticket not found');

    await act(host, [guest], { type: 'reveal' });
    state = await act(host, [guest], { type: 'selectTicket', ticketId: first });
    expect(state).toMatchObject({ activeTicketId: first, revealed: false, votes: null, myVote: null });
    expect(state.users.every((u: Message) => !u.hasVoted)).toBe(true);
  });

  it('rejects a vote cast for the previous round after the host switches ticket', async () => {
    const { host, guest, guestId } = await twoUsers();
    const [first, second] = await addTickets(host, guest, 'One', 'Two');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    const staleRound = round;
    const switched = await act(host, [guest], { type: 'selectTicket', ticketId: second });
    expect(switched.round).toBeGreaterThan(staleRound);

    guest.send(vote('8', staleRound));
    expect((await guest.next('error')).message).toBe('Vote was for a previous round');
    await act(guest, [host], vote('5', round));
    const revealed = await act(host, [guest], { type: 'reveal' });
    expect(revealed.tickets[1].result.votes).toEqual({ [guestId]: '5' });
  });

  it('starts a new round on reset and on removing the active ticket', async () => {
    const { host, guest } = await twoUsers();
    const [first] = await addTickets(host, guest, 'One');
    const initial = round;
    await act(guest, [host], vote('5', round));
    const reset = await act(host, [guest], { type: 'reset' });
    expect(reset.round).toBe(initial + 1);
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    const removed = await act(host, [guest], { type: 'removeTicket', ticketId: first });
    expect(removed.round).toBe(initial + 3);
  });
  it('keeps a revealed result per ticket across switching, reset and participants leaving', async () => {
    const { host, guest, hostId, guestId } = await twoUsers();
    const [first, second] = await addTickets(host, guest, 'One', 'Two');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await act(guest, [host], vote('8', round));
    const revealed = await act(host, [guest], { type: 'reveal' });
    const expectedResult = {
      users: [
        { id: hostId, name: 'Host' },
        { id: guestId, name: 'Guest', avatar: 'penguin' },
      ],
      votes: { [guestId]: '8' },
    };
    expect(revealed.tickets[0].result).toEqual(expectedResult);

    await act(host, [guest], { type: 'reset' });
    const switched = await act(host, [guest], { type: 'selectTicket', ticketId: second });
    expect(switched.tickets[0].result).toEqual(expectedResult);
    expect(switched.tickets[1].result).toBeNull();

    await guest.close();
    expect((await host.next('state')).tickets[0].result).toEqual(expectedResult);

    await act(host, [], { type: 'selectTicket', ticketId: first });
    await act(host, [], vote('3', round));
    const overwritten = await act(host, [], { type: 'reveal' });
    expect(overwritten.tickets[0].result).toEqual({ users: [{ id: hostId, name: 'Host' }], votes: { [hostId]: '3' } });
  });

  it('stores no result when revealing with no active ticket', async () => {
    const { host, guest } = await twoUsers();
    await addTickets(host, guest, 'One');
    await act(guest, [host], vote('5', round));
    const state = await act(host, [guest], { type: 'reveal' });
    expect(state.revealed).toBe(true);
    expect(state.tickets[0].result).toBeNull();
  });

  it('edits any ticket, including the active one, keeping votes and its stored result', async () => {
    const { host, guest, guestId } = await twoUsers();
    const [first, second] = await addTickets(host, guest, 'One', 'Two');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await act(guest, [host], vote('5', round));
    await act(host, [guest], { type: 'reveal' });
    await act(host, [guest], { type: 'reset' });
    await act(guest, [host], vote('13', round));

    const edited = await act(host, [guest], { type: 'editTicket', ticketId: first, content: '  One with SSO ' });
    expect(edited.tickets[0]).toMatchObject({ content: 'One with SSO', result: { votes: { [guestId]: '5' } } });
    expect(edited.activeTicketId).toBe(first);
    expect(edited.users.find((u: Message) => u.id === guestId).hasVoted).toBe(true);

    const other = await act(host, [guest], { type: 'editTicket', ticketId: second, content: 'Two edited' });
    expect(other.tickets.map((t: Message) => t.content)).toEqual(['One with SSO', 'Two edited']);

    host.send({ type: 'editTicket', ticketId: 'ticket-missing', content: 'X' });
    expect((await host.next('error')).message).toBe('Ticket not found');
  });

  it('adds a spike ticket and stores its revealed day votes, kept across reset', async () => {
    const { host, guest, guestId } = await twoUsers();
    const added = await act(host, [guest], addTicket('Investigate SSO', 'spike'));
    const [spike] = added.tickets;
    expect(spike).toMatchObject({ type: 'spike', content: 'Investigate SSO', result: null });

    await act(host, [guest], { type: 'selectTicket', ticketId: spike.id });
    await act(guest, [host], vote('3', round));
    await act(host, [guest], vote('☕', round));
    const revealed = await act(host, [guest], { type: 'reveal' });
    expect(revealed.votes).toMatchObject({ [guestId]: '3' });
    expect(revealed.tickets[0].result.votes).toMatchObject({ [guestId]: '3' });

    const reset = await act(host, [guest], { type: 'reset' });
    expect(reset).toMatchObject({ revealed: false, votes: null });
    expect(reset.tickets[0].result.votes).toMatchObject({ [guestId]: '3' });
  });

  it('changing the active ticket type clears votes, reveal and its result, and starts a new round', async () => {
    const { host, guest, guestId } = await twoUsers();
    const [first] = await addTickets(host, guest, 'One');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await act(guest, [host], vote('8', round));
    await act(host, [guest], { type: 'reveal' });
    const before = round;

    const changed = await act(host, [guest], { type: 'editTicket', ticketId: first, content: 'One', ticketType: 'spike' });
    expect(changed.tickets[0]).toMatchObject({ type: 'spike', result: null });
    expect(changed).toMatchObject({ activeTicketId: first, revealed: false, votes: null, myVote: null, round: before + 1 });
    expect(changed.users.find((u: Message) => u.id === guestId).hasVoted).toBe(false);

    guest.send(vote('8', before));
    expect((await guest.next('error')).message).toBe('Vote was for a previous round');

    await act(guest, [host], vote('2', round));
    const back = await act(host, [guest], { type: 'editTicket', ticketId: first, content: 'One', ticketType: 'story' });
    expect(back.tickets[0].type).toBe('story');
    expect(back.users.every((u: Message) => !u.hasVoted)).toBe(true);
  });

  it('changing an inactive ticket type clears only its result', async () => {
    const { host, guest, guestId } = await twoUsers();
    const [first, second] = await addTickets(host, guest, 'One', 'Two');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await act(guest, [host], vote('5', round));
    await act(host, [guest], { type: 'reveal' });
    await act(host, [guest], { type: 'selectTicket', ticketId: second });
    await act(guest, [host], vote('3', round));
    const before = round;

    const changed = await act(host, [guest], { type: 'editTicket', ticketId: first, content: 'One', ticketType: 'spike' });
    expect(changed.tickets[0]).toMatchObject({ type: 'spike', result: null });
    expect(changed).toMatchObject({ activeTicketId: second, round: before });
    expect(changed.users.find((u: Message) => u.id === guestId).hasVoted).toBe(true);
  });

  it('keeps votes and result when the ticketType sent is unchanged', async () => {
    const { host, guest, guestId } = await twoUsers();
    const [first] = await addTickets(host, guest, 'One');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await act(guest, [host], vote('5', round));
    await act(host, [guest], { type: 'reveal' });
    await act(host, [guest], { type: 'reset' });
    await act(guest, [host], vote('8', round));
    const before = round;

    const edited = await act(host, [guest], { type: 'editTicket', ticketId: first, content: 'One!', ticketType: 'story' });
    expect(edited.tickets[0]).toMatchObject({ content: 'One!', type: 'story', result: { votes: { [guestId]: '5' } } });
    expect(edited.round).toBe(before);
    expect(edited.users.find((u: Message) => u.id === guestId).hasVoted).toBe(true);
  });

  it('rejects an invalid ticketType and a non-host type change without broadcasting', async () => {
    const { host, guest } = await twoUsers();
    const [first] = await addTickets(host, guest, 'One');
    host.send({ type: 'editTicket', ticketId: first, content: 'One', ticketType: 'epic' });
    expect((await host.next('error')).message).toBe('Invalid editTicket message');
    guest.send({ type: 'editTicket', ticketId: first, content: 'One', ticketType: 'spike' });
    expect((await guest.next('error')).message).toBe('Only the host can edit tickets');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.messages).toEqual([]);
    expect(guest.messages).toEqual([]);
  });

  it('removes the active ticket, clearing the round and leaving no ticket active', async () => {
    const { host, guest } = await twoUsers();
    const [first, second] = await addTickets(host, guest, 'One', 'Two');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await act(guest, [host], vote('5', round));

    const state = await act(host, [guest], { type: 'removeTicket', ticketId: first });
    expect(state.tickets.map((t: Message) => t.id)).toEqual([second]);
    expect(state).toMatchObject({ activeTicketId: null, revealed: false, votes: null });
    expect(state.users.every((u: Message) => !u.hasVoted)).toBe(true);

    host.send({ type: 'removeTicket', ticketId: first });
    expect((await host.next('error')).message).toBe('Ticket not found');
  });

  it('removes an inactive ticket without touching the current round', async () => {
    const { host, guest, guestId } = await twoUsers();
    const [first, second] = await addTickets(host, guest, 'One', 'Two');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await act(guest, [host], vote('5', round));

    const state = await act(host, [guest], { type: 'removeTicket', ticketId: second });
    expect(state.activeTicketId).toBe(first);
    expect(state.users.find((u: Message) => u.id === guestId).hasVoted).toBe(true);
  });

  it('keeps tickets when the host leaves and lets the promoted host manage them', async () => {
    const { host, guest, guestId } = await twoUsers();
    const [first] = await addTickets(host, guest, 'Login');
    await act(host, [guest], { type: 'selectTicket', ticketId: first });
    await host.close();
    const promoted = await guest.next('state');
    expect(promoted).toMatchObject({ hostId: guestId, activeTicketId: first, tickets: [{ content: 'Login' }] });

    const state = await act(guest, [], { type: 'editTicket', ticketId: first, content: 'Logout' });
    expect(state.tickets[0].content).toBe('Logout');
  });
});

describe('participate and spectate', () => {
  let round = 0;

  async function twoUsers() {
    round = 0;
    await start();
    const host = await connect(port, { room: ROOM, name: 'Host' });
    const { userId: hostId } = await host.next('welcome');
    const guest = await connect(port, { room: ROOM, name: 'Guest' });
    const { userId: guestId } = await guest.next('welcome');
    await host.settledState();
    await guest.settledState();
    return { host, guest, hostId, guestId };
  }

  async function act(sender: TestClient, others: TestClient[], message: unknown): Promise<Message> {
    sender.send(message);
    const state = await sender.next('state');
    for (const other of others) await other.next('state');
    round = state.round;
    return state;
  }

  const spectate = (spectating: unknown) => ({ type: 'setSpectating', spectating });
  const user = (state: Message, id: string) => state.users.find((u: Message) => u.id === id);

  it('broadcasts switching to spectating and back to everyone', async () => {
    const { host, guest, guestId } = await twoUsers();
    guest.send(spectate(true));
    const [hostView, guestView] = [await host.next('state'), await guest.next('state')];
    expect(user(hostView, guestId).spectating).toBe(true);
    expect(user(guestView, guestId).spectating).toBe(true);

    const back = await act(guest, [host], spectate(false));
    expect(user(back, guestId).spectating).toBe(false);
  });

  it('rejects votes from a spectator, and accepts them after switching back', async () => {
    const { host, guest, guestId } = await twoUsers();
    await act(guest, [host], spectate(true));
    guest.send(vote('5', round));
    expect((await guest.next('error')).message).toBe('Spectators cannot vote');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.messages).toEqual([]);

    await act(guest, [host], spectate(false));
    const voted = await act(guest, [host], vote('5', round));
    expect(user(voted, guestId).hasVoted).toBe(true);
  });

  it('discards an unrevealed vote when switching to spectating', async () => {
    const { host, guest, guestId } = await twoUsers();
    await act(guest, [host], vote('5', round));
    const state = await act(guest, [host], spectate(true));
    expect(user(state, guestId).hasVoted).toBe(false);
    expect(state.myVote).toBeNull();

    const revealed = await act(host, [guest], { type: 'reveal' });
    expect(revealed.votes).toEqual({});
  });

  it('keeps revealed votes and the stored result when switching after reveal', async () => {
    const { host, guest, hostId, guestId } = await twoUsers();
    const added = await act(host, [guest], { type: 'addTicket', ticket: { type: 'story', content: 'One' } });
    await act(host, [guest], { type: 'selectTicket', ticketId: added.tickets[0].id });
    await act(guest, [host], vote('8', round));
    await act(host, [guest], { type: 'reveal' });

    const state = await act(guest, [host], spectate(true));
    expect(state.votes).toEqual({ [guestId]: '8' });
    expect(state.tickets[0].result).toEqual({
      users: [
        { id: hostId, name: 'Host' },
        { id: guestId, name: 'Guest' },
      ],
      votes: { [guestId]: '8' },
    });

    const reset = await act(host, [guest], { type: 'reset' });
    expect(user(reset, guestId)).toMatchObject({ spectating: true, hasVoted: false });
  });

  it('leaves spectators without a vote out of the stored result', async () => {
    const { host, guest, guestId } = await twoUsers();
    const added = await act(host, [guest], { type: 'addTicket', ticket: { type: 'story', content: 'One' } });
    await act(host, [guest], { type: 'selectTicket', ticketId: added.tickets[0].id });
    await act(host, [guest], spectate(true));
    await act(guest, [host], vote('3', round));

    const revealed = await act(host, [guest], { type: 'reveal' });
    expect(revealed.tickets[0].result).toEqual({ users: [{ id: guestId, name: 'Guest' }], votes: { [guestId]: '3' } });
  });

  it('lets a spectating host keep every host action', async () => {
    const { host, guest, hostId } = await twoUsers();
    const spectating = await act(host, [guest], spectate(true));
    expect(spectating.hostId).toBe(hostId);

    const added = await act(host, [guest], { type: 'addTicket', ticket: { type: 'story', content: 'One' } });
    await act(host, [guest], { type: 'selectTicket', ticketId: added.tickets[0].id });
    await act(guest, [host], vote('5', round));
    expect((await act(host, [guest], { type: 'reveal' })).revealed).toBe(true);
    expect((await act(host, [guest], { type: 'reset' })).revealed).toBe(false);
  });

  it.each([['missing', undefined], ['string', 'true'], ['number', 1], ['null', null]])(
    'rejects a %s spectating value without broadcasting',
    async (_label, value) => {
      const { host, guest } = await twoUsers();
      guest.send(spectate(value));
      expect((await guest.next('error')).message).toBe('Invalid setSpectating message');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(host.messages).toEqual([]);
    },
  );
});

describe('rate limiting', () => {
  it('rejects messages over the limit and keeps the socket open', async () => {
    await start({ rateLimitMax: 2, rateLimitWindowMs: 60_000 });
    const client = await connect(port, { room: ROOM, name: 'Spammy' });
    await client.next('state');

    client.send(vote('1'));
    client.send(vote('2'));
    client.send(vote('3'));
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
