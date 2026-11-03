import { act, render, screen, within } from '@testing-library/react';
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
      tickets: [],
      activeTicketId: null,
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
      tickets: [],
      activeTicketId: null,
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
    const roomState = (myVote: string | null, hostId = 'user-a') => ({
      type: 'state',
      hostId,
      revealed: false,
      tickets: [
        { id: 'ticket-1', type: 'story', content: 'Login page', result: null },
        { id: 'ticket-2', type: 'story', content: 'Logout', result: null },
      ],
      activeTicketId: 'ticket-1',
      round: 0,
      users: [
        { id: 'user-a', name: 'Alice', avatar: 'cat', hasVoted: false },
        { id: 'user-b', name: 'Bob', avatar: 'penguin', hasVoted: myVote !== null },
      ],
      votes: null,
      myVote,
    });

    async function joinAs(userId: string, hostId = 'user-a') {
      mockRoomStatus({ exists: true, userCount: 1, capacity: 50, full: false });
      render(<RoomPage roomId={ROOM} />);
      await fillAndJoin('Bob', 'Penguin');
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const ws = FakeWebSocket.instances[0];
      ws.emit({ type: 'welcome', userId });
      ws.emit(roomState(null, hostId));
      return ws;
    }

    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

    it('sends my vote, highlights the vote the server holds, and lets me change it', async () => {
      const ws = await joinAs('user-b');
      const user = userEvent.setup();
      expect(screen.getByText('Now voting:').parentElement).toHaveTextContent('Now voting: Login page');

      await user.click(screen.getByRole('button', { name: '5' }));
      expect(ws.sent).toEqual([{ type: 'vote', value: '5', round: 0 }]);
      ws.emit(roomState('5'));
      expect(pressed('5')).toBe('true');

      await user.click(screen.getByRole('button', { name: '13' }));
      expect(ws.sent.at(-1)).toEqual({ type: 'vote', value: '13', round: 0 });
      ws.emit(roomState('13'));
      expect(pressed('13')).toBe('true');
      expect(pressed('5')).toBe('false');
    });

    it('keeps the accepted vote highlighted when a re-vote is rejected', async () => {
      const ws = await joinAs('user-b');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: '5' }));
      ws.emit(roomState('5'));

      await user.click(screen.getByRole('button', { name: '13' }));
      ws.emit({ type: 'error', message: 'Rate limit exceeded' });
      expect(pressed('5')).toBe('true');
      expect(pressed('13')).toBe('false');
      expect(screen.getByRole('alert')).toHaveTextContent('Rate limit exceeded');
    });

    it('tags my vote with the round from the latest state', async () => {
      const ws = await joinAs('user-b');
      ws.emit({ ...roomState(null), activeTicketId: 'ticket-2', round: 4 });
      await userEvent.setup().click(screen.getByRole('button', { name: '8' }));
      expect(ws.sent).toEqual([{ type: 'vote', value: '8', round: 4 }]);

      ws.emit({ type: 'error', message: 'Vote was for a previous round' });
      expect(screen.getByRole('alert')).toHaveTextContent('Vote was for a previous round');
    });

    it('clears my highlighted card when the server says I have no vote', async () => {
      const ws = await joinAs('user-b');
      await userEvent.setup().click(screen.getByRole('button', { name: '8' }));
      ws.emit(roomState('8'));
      ws.emit(roomState(null));
      expect(pressed('8')).toBe('false');
    });

    it('sends ticket list actions from the host, confirming before removal', async () => {
      const ws = await joinAs('user-b', 'user-b');
      const user = userEvent.setup();
      const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
      vi.stubGlobal('confirm', confirm);

      await user.type(screen.getByLabelText('What are we estimating?'), 'Signup');
      await user.click(screen.getByRole('button', { name: 'Add ticket' }));
      expect(screen.getByLabelText('What are we estimating?')).toHaveValue('Signup');

      const tickets = within(screen.getByRole('list', { name: 'Tickets' })).getAllByRole('listitem');
      expect(tickets[0]).toHaveAttribute('aria-current', 'true');
      expect(within(tickets[0]).queryByRole('button', { name: 'Start voting' })).not.toBeInTheDocument();
      await user.click(within(tickets[1]).getByRole('button', { name: 'Start voting' }));

      await user.click(within(tickets[0]).getByRole('button', { name: 'Edit' }));
      const editor = within(tickets[0]).getByLabelText('Edit ticket text');
      expect(editor).toHaveValue('Login page');
      await user.clear(editor);
      await user.type(editor, 'Login with SSO');
      await user.click(within(tickets[0]).getByRole('button', { name: 'Save' }));

      await user.click(within(tickets[0]).getByRole('button', { name: 'Remove' }));
      await user.click(within(tickets[0]).getByRole('button', { name: 'Remove' }));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Login page'));

      expect(ws.sent).toEqual([
        { type: 'addTicket', ticket: { type: 'story', content: 'Signup' } },
        { type: 'selectTicket', ticketId: 'ticket-2' },
        { type: 'editTicket', ticketId: 'ticket-1', content: 'Login with SSO' },
        { type: 'removeTicket', ticketId: 'ticket-1' },
      ]);
    });

    it('shows the ticket list read-only to participants and no active ticket after removal', async () => {
      const ws = await joinAs('user-b');
      const list = within(screen.getByRole('list', { name: 'Tickets' }));
      expect(list.getAllByRole('listitem').map((item) => item.querySelector('.ticket-content')?.textContent)).toEqual([
        'Login page',
        'Logout',
      ]);
      expect(screen.getByText('Now voting:').parentElement).toHaveTextContent('Now voting: Login page');
      for (const name of ['Start voting', 'Edit', 'Remove', 'Add ticket']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }

      ws.emit({ ...roomState(null), tickets: [roomState(null).tickets[1]], activeTicketId: null });
      expect(screen.getByText('Waiting for the host to choose a ticket.')).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Tickets' })).not.toHaveTextContent('Active');
    });

    it('lets anyone view a previous ticket result after switching away', async () => {
      const ws = await joinAs('user-b');
      const [first, second] = roomState(null).tickets;
      ws.emit({
        ...roomState(null),
        tickets: [{ ...first, result: { users: [{ id: 'user-a', name: 'Alice' }], votes: { 'user-a': '8' } } }, second],
        activeTicketId: 'ticket-2',
      });
      const user = userEvent.setup();
      const toggle = screen.getByRole('button', { name: 'Show results' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);

      expect(screen.getByRole('heading', { name: 'Previous results' })).toBeInTheDocument();
      expect(screen.getByRole('meter', { name: '8: 1 vote' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Hide results' }));
      expect(screen.queryByRole('heading', { name: 'Previous results' })).not.toBeInTheDocument();
    });

    it('keeps the add draft when the server rejects it and clears it once the ticket is added', async () => {
      const ws = await joinAs('user-b', 'user-b');
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('What are we estimating?'), 'Signup');
      await user.click(screen.getByRole('button', { name: 'Add ticket' }));
      ws.emit({ type: 'error', message: 'A room can have at most 10 tickets' });
      expect(screen.getByRole('alert')).toHaveTextContent('A room can have at most 10 tickets');
      expect(screen.getByLabelText('What are we estimating?')).toHaveValue('Signup');

      await user.click(screen.getByRole('button', { name: 'Add ticket' }));
      const base = roomState(null, 'user-b');
      ws.emit({ ...base, tickets: [...base.tickets, { id: 'ticket-3', type: 'story', content: 'Signup', result: null }] });
      expect(screen.getByLabelText('What are we estimating?')).toHaveValue('');
    });

    it('shows voting controls only to the current host and sends reveal/reset messages', async () => {
      const ws = await joinAs('user-b');
      expect(screen.queryByRole('button', { name: 'Reveal votes' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset votes' })).not.toBeInTheDocument();

      ws.emit(roomState(null, 'user-b'));
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Reveal votes' }));
      await user.click(screen.getByRole('button', { name: 'Reset votes' }));

      expect(ws.sent.slice(-2)).toEqual([{ type: 'reveal' }, { type: 'reset' }]);
    });

    it('shows frequency-sorted votes and each participant result', async () => {
      const ws = await joinAs('user-b');
      ws.emit({
        ...roomState(null),
        revealed: true,
        users: [
          { id: 'user-a', name: 'Sam', hasVoted: true },
          { id: 'user-b', name: 'Sam', hasVoted: true },
          { id: 'user-c', name: 'Ava', hasVoted: true },
          { id: 'user-d', name: 'Lee', hasVoted: true },
          { id: 'user-e', name: 'Moe', hasVoted: true },
          { id: 'user-f', name: 'Kai', hasVoted: true },
          { id: 'user-g', name: 'Noah', hasVoted: false },
        ],
        votes: {
          'user-a': '5',
          'user-b': '3',
          'user-c': '1',
          'user-d': 'mystery-z',
          'user-e': 'mystery-a',
          'user-f': '5',
        },
      });

      expect(within(screen.getByRole('list', { name: 'Vote frequency' })).getAllByRole('meter').map((meter) => meter.getAttribute('aria-label'))).toEqual([
        '5: 2 votes',
        '1: 1 vote',
        '3: 1 vote',
        'mystery-z: 1 vote',
        'mystery-a: 1 vote',
      ]);
      const participants = within(screen.getByRole('list', { name: 'Participant votes' }));
      const rows = participants.getAllByRole('listitem');
      expect(rows[0]).toHaveTextContent('Sam (1)5');
      expect(rows[1]).toHaveTextContent('Sam (2)3');
      expect(rows[6]).toHaveTextContent('NoahNo vote');
    });

    it('never gives two participants the same label when a name already looks suffixed', async () => {
      const ws = await joinAs('user-b');
      ws.emit({
        ...roomState(null),
        revealed: true,
        users: [
          { id: 'user-a', name: 'Sam', hasVoted: true },
          { id: 'user-b', name: 'Sam', hasVoted: true },
          { id: 'user-c', name: 'Sam (1)', hasVoted: true },
        ],
        votes: { 'user-a': '1', 'user-b': '2', 'user-c': '3' },
      });

      const rows = within(screen.getByRole('list', { name: 'Participant votes' })).getAllByRole('listitem');
      expect(rows.map((row) => row.textContent)).toEqual(['Sam (2)1', 'Sam (3)2', 'Sam (1)3']);
    });

    it('shows an empty graph when votes are revealed before anyone votes', async () => {
      const ws = await joinAs('user-b');
      ws.emit({ ...roomState(null), revealed: true, votes: {} });

      expect(screen.getByRole('status')).toHaveTextContent('No votes to graph yet.');
      expect(within(screen.getByRole('list', { name: 'Participant votes' })).getAllByText('No vote')).toHaveLength(2);
    });

    it.each([
      {
        label: 'already revealed',
        revealed: true,
        votes: { 'user-a': '5' },
        action: 'Reveal votes',
        message: 'Votes are already revealed',
      },
      {
        label: 'already reset',
        revealed: false,
        votes: null,
        action: 'Reset votes',
        message: 'Votes are already reset',
      },
    ])('shows the server error when votes are $label without changing the view', async ({ revealed, votes, action, message }) => {
      const ws = await joinAs('user-a', 'user-a');
      ws.emit({ ...roomState(null, 'user-a'), revealed, votes });
      await userEvent.setup().click(screen.getByRole('button', { name: action }));
      ws.emit({ type: 'error', message });

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByText('No votes to graph yet.')).not.toBeInTheDocument();
      if (revealed) {
        expect(screen.getByRole('heading', { name: 'Vote results' })).toBeInTheDocument();
        expect(screen.getByRole('meter', { name: '5: 1 vote' })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole('heading', { name: 'Vote results' })).not.toBeInTheDocument();
      }
    });

    it('clears revealed results after a successful reset broadcast', async () => {
      const ws = await joinAs('user-a', 'user-a');
      ws.emit({ ...roomState(null, 'user-a'), revealed: true, votes: { 'user-a': '5' } });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Reset votes' }));
      expect(ws.sent.at(-1)).toEqual({ type: 'reset' });

      ws.emit({
        ...roomState(null, 'user-a'),
        revealed: false,
        users: [
          { id: 'user-a', name: 'Alice', hasVoted: false },
          { id: 'user-b', name: 'Bob', hasVoted: false },
        ],
        votes: null,
      });
      expect(screen.queryByRole('heading', { name: 'Vote results' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '5' })).toBeEnabled();
    });
  });

  describe('after a server_shutdown close', () => {
    const state = {
      type: 'state',
      hostId: 'user-a',
      revealed: false,
      tickets: [],
      activeTicketId: null,
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
