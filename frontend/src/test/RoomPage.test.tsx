import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomPage } from '../RoomPage';
import { markCreator } from '../room';
import { MAX_RECONNECT_ATTEMPTS, reconnectDelay } from '../useRoom';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: unknown[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {}

  emit(message: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }

  serverClose(code: number) {
    act(() => this.onclose?.({ code }));
  }
}

const ROOM = 'xk29-4plm';

function mockRoomStatus(body: object) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fillAndJoin(name = 'Alice', avatar = 'Capybara') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Your name'), name);
  await user.click(screen.getByRole('radio', { name: avatar }));
  await user.click(screen.getByRole('button', { name: 'Join room' }));
}

describe('RoomPage', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  it('tells the person the room is full and does not connect', async () => {
    const fetchMock = mockRoomStatus({ exists: true, userCount: 50, capacity: 50, full: true });
    render(<RoomPage roomId={ROOM} />);
    await fillAndJoin();

    expect(await screen.findByRole('alert')).toHaveTextContent("This room is full (50/50) — you can't join right now.");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/rooms\/xk29-4plm$/));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('joins, then shows the live roster with the host and the share link', async () => {
    mockRoomStatus({ exists: true, userCount: 1, capacity: 50, full: false });
    render(<RoomPage roomId={ROOM} />);
    await fillAndJoin('Bob', 'Penguin');

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    const params = new URL(ws.url).searchParams;
    expect(Object.fromEntries(params)).toEqual({ room: ROOM, name: 'Bob', avatar: 'penguin' });

    ws.emit({ type: 'welcome', userId: 'user-b' });
    ws.emit({
      type: 'state',
      hostId: 'user-a',
      revealed: false,
      users: [
        { id: 'user-a', name: 'Alice', avatar: 'cat', hasVoted: false },
        { id: 'user-b', name: 'Bob', avatar: 'penguin', hasVoted: false },
      ],
      votes: null,
    });

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('AliceHost');
    expect(items[1]).toHaveTextContent('Bob (you)');
    expect(screen.getByLabelText('Invite your team with this link')).toHaveValue(
      `${window.location.origin}${window.location.pathname}?room=${ROOM}`,
    );

    ws.emit({
      type: 'state',
      hostId: 'user-b',
      revealed: false,
      users: [{ id: 'user-b', name: 'Bob', avatar: 'penguin', hasVoted: false }],
      votes: null,
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem')).toHaveTextContent('Bob (you)Host');
  });

  it('sends the default deck only when this tab created the room', async () => {
    markCreator(ROOM);
    mockRoomStatus({ exists: false, userCount: 0, capacity: 50, full: false });
    render(<RoomPage roomId={ROOM} />);
    await fillAndJoin();

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(new URL(FakeWebSocket.instances[0].url).searchParams.get('deck')).toBe('fibonacci');
  });

  it('shows a fallback message if the connection is refused before joining', async () => {
    mockRoomStatus({ exists: true, userCount: 49, capacity: 50, full: false });
    render(<RoomPage roomId={ROOM} />);
    await fillAndJoin();

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].serverClose(1006);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't join — the room may be full or unavailable.");
  });

  it('shows an error when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<RoomPage roomId={ROOM} />);
    await fillAndJoin();

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach the server. Please try again.");
  });

  describe('voting on a story ticket', () => {
    const roomState = (hasVoted: boolean, hostId = 'user-a') => ({
      type: 'state',
      hostId,
      revealed: false,
      ticket: { type: 'story', content: 'Login page' },
      users: [
        { id: 'user-a', name: 'Alice', avatar: 'cat', hasVoted: false },
        { id: 'user-b', name: 'Bob', avatar: 'penguin', hasVoted },
      ],
      votes: null,
    });

    async function joinAs(userId: string, hostId = 'user-a') {
      mockRoomStatus({ exists: true, userCount: 1, capacity: 50, full: false });
      render(<RoomPage roomId={ROOM} />);
      await fillAndJoin('Bob', 'Penguin');
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const ws = FakeWebSocket.instances[0];
      ws.emit({ type: 'welcome', userId });
      ws.emit(roomState(false, hostId));
      return ws;
    }

    it('sends my vote, highlights it once the server confirms, and lets me change it', async () => {
      const ws = await joinAs('user-b');
      const user = userEvent.setup();
      expect(screen.getByText('Login page')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '5' }));
      expect(ws.sent).toEqual([{ type: 'vote', value: '5' }]);
      ws.emit(roomState(true));
      expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true');

      await user.click(screen.getByRole('button', { name: '13' }));
      expect(ws.sent.at(-1)).toEqual({ type: 'vote', value: '13' });
      expect(screen.getByRole('button', { name: '13' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('clears my highlighted card when the server says I have not voted', async () => {
      const ws = await joinAs('user-b');
      await userEvent.setup().click(screen.getByRole('button', { name: '8' }));
      ws.emit(roomState(true));
      ws.emit(roomState(false));
      expect(screen.getByRole('button', { name: '8' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('lets the host set the ticket', async () => {
      const ws = await joinAs('user-b', 'user-b');
      const user = userEvent.setup();
      const textarea = screen.getByLabelText('What are we estimating?');
      await user.clear(textarea);
      await user.type(textarea, 'Logout');
      await user.click(screen.getByRole('button', { name: 'Update ticket' }));
      expect(ws.sent).toEqual([{ type: 'setTicket', ticket: { type: 'story', content: 'Logout' } }]);
    });
  });

  describe('after a server_shutdown close', () => {
    const state = {
      type: 'state',
      hostId: 'user-a',
      revealed: false,
      users: [{ id: 'user-a', name: 'Alice', avatar: 'capybara', hasVoted: false }],
      votes: null,
    };

    async function joinThenShutdown() {
      mockRoomStatus({ exists: false, userCount: 0, capacity: 50, full: false });
      const view = render(<RoomPage roomId={ROOM} />);
      await fillAndJoin();
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      FakeWebSocket.instances[0].emit({ type: 'welcome', userId: 'user-a' });
      FakeWebSocket.instances[0].emit(state);
      vi.useFakeTimers();
      FakeWebSocket.instances[0].serverClose(1001);
      return view;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

    it('keeps retrying with backoff until the server is back', async () => {
      await joinThenShutdown();
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

      advance(reconnectDelay(0));
      expect(FakeWebSocket.instances).toHaveLength(2);
      FakeWebSocket.instances[1].serverClose(1006);
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

      advance(reconnectDelay(1) - 1);
      expect(FakeWebSocket.instances).toHaveLength(2);
      advance(1);
      expect(FakeWebSocket.instances).toHaveLength(3);

      FakeWebSocket.instances[2].emit({ type: 'welcome', userId: 'user-a2' });
      FakeWebSocket.instances[2].emit({ ...state, hostId: 'user-a2', users: [{ ...state.users[0], id: 'user-a2' }] });
      expect(screen.getByRole('listitem')).toHaveTextContent('Alice (you)Host');
    });

    it('gives up after the maximum number of attempts', async () => {
      await joinThenShutdown();
      for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
        advance(reconnectDelay(attempt));
        FakeWebSocket.instances.at(-1)!.serverClose(1006);
      }
      expect(FakeWebSocket.instances).toHaveLength(1 + MAX_RECONNECT_ATTEMPTS);
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't join — the room may be full or unavailable.");
    });

    it('cancels pending retries on unmount', async () => {
      const { unmount } = await joinThenShutdown();
      unmount();
      advance(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });
});
