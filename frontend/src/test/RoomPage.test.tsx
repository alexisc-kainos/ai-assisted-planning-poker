import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

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
    const sidebar = screen.getByRole('complementary', { name: 'Room' });
    expect(sidebar).toHaveClass('room-side');
    expect(within(sidebar).getByRole('region', { name: 'Share this room' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('switch', { name: 'Spectate' })).toBeInTheDocument();
    expect(within(sidebar).getAllByRole('listitem')).toHaveLength(2);
    expect(sidebar.querySelector('img')).toHaveAttribute('src', expect.stringContaining('cat.jpg'));
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

  it('sends the default deck and spectator mode only when this tab created the room', async () => {
    markCreator(ROOM);
    mockRoomStatus({ exists: false, userCount: 0, capacity: 50, full: false });
    render(<RoomPage roomId={ROOM} />);
    await fillAndJoin();

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const params = new URL(FakeWebSocket.instances[0].url).searchParams;
    expect(params.get('deck')).toBe('fibonacci');
    expect(params.get('spectating')).toBe('1');
  });

  it('shows a fallback message if the connection is refused before joining', async () => {
    mockRoomStatus({ exists: true, userCount: 49, capacity: 50, full: false });
    render(<RoomPage roomId={ROOM} />);
    await fillAndJoin();

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].serverClose(1006);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't join — the room may be full or unavailable.");
  });

  describe('names already in the room', () => {
    const status = (members: Array<{ name: string; away: boolean }>, full = false) => ({
      ok: true,
      json: async () => ({ exists: true, userCount: members.length, capacity: 50, full, members }),
    });
    const takenMessage = 'Someone in this room is already called Alice. Please choose a different name.';

    it('checks the name against the room as the person types', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status([{ name: 'Alice', away: false }])));
      render(<RoomPage roomId={ROOM} />);
      const user = userEvent.setup();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole('radio', { name: 'Cat' }));
      await user.type(screen.getByLabelText('Your name'), 'alice ');

      expect(screen.getByRole('alert')).toHaveTextContent(takenMessage);
      expect(screen.getByRole('button', { name: 'Join room' })).toBeDisabled();
    });

    describe('member status refresh', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('offers takeover when a matching member becomes away while the form is open', async () => {
        vi.useFakeTimers();
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(status([]))
          .mockResolvedValue(status([{ name: 'Alice', away: true }]));
        vi.stubGlobal('fetch', fetchMock);
        render(<RoomPage roomId={ROOM} />);
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alice' } });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });

        expect(screen.getByRole('status')).toHaveTextContent('Alice is away in this room. Is that you?');
      });
    });

    it('rejects a name taken after the form loaded when Join is pressed', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(status([]))
        .mockResolvedValue(status([{ name: 'Alice', away: false }]));
      vi.stubGlobal('fetch', fetchMock);
      render(<RoomPage roomId={ROOM} />);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await fillAndJoin('Alice');

      expect(await screen.findByRole('alert')).toHaveTextContent(takenMessage);
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Join room' })).toBeDisabled();
    });

    it('offers takeover when an away member is discovered in a full room', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(status([]))
        .mockResolvedValue(status([{ name: 'Alice', away: true }], true));
      vi.stubGlobal('fetch', fetchMock);
      render(<RoomPage roomId={ROOM} />);
      await fillAndJoin('Alice');

      const takeover = await screen.findByRole('button', { name: 'Rejoin as Alice' });
      expect(FakeWebSocket.instances).toHaveLength(0);
      await userEvent.setup().click(takeover);

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(new URL(FakeWebSocket.instances[0].url).searchParams.get('takeover')).toBe('1');
    });

    it('explains a refused connection when the name was taken in the meantime', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(status([]))
        .mockResolvedValueOnce(status([]))
        .mockResolvedValue(status([{ name: 'Alice', away: false }]));
      vi.stubGlobal('fetch', fetchMock);
      render(<RoomPage roomId={ROOM} />);
      await fillAndJoin('Alice');
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      FakeWebSocket.instances[0].serverClose(1006);

      expect(await screen.findByRole('alert')).toHaveTextContent(takenMessage);
      expect(screen.queryByText(/Couldn't join/)).not.toBeInTheDocument();
    });

    it('rejoins as an away member with takeover and no avatar', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status([{ name: 'Alice', away: true }])));
      render(<RoomPage roomId={ROOM} />);
      const user = userEvent.setup();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await user.type(screen.getByLabelText('Your name'), 'ALICE');
      expect(screen.getByRole('status')).toHaveTextContent('Alice is away in this room. Is that you?');
      await user.click(screen.getByRole('button', { name: 'Rejoin as Alice' }));

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(Object.fromEntries(new URL(FakeWebSocket.instances[0].url).searchParams)).toEqual({
        room: ROOM,
        name: 'Alice',
        takeover: '1',
      });
      FakeWebSocket.instances[0].emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      expect(localStorage.getItem(`ppk:session:${ROOM}`)).toBe(TOKEN);
    });

    it('shows the taken message if the away member came back before the takeover', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(status([{ name: 'Alice', away: true }]))
        .mockResolvedValue(status([{ name: 'Alice', away: false }]));
      vi.stubGlobal('fetch', fetchMock);
      render(<RoomPage roomId={ROOM} />);
      const user = userEvent.setup();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await user.type(screen.getByLabelText('Your name'), 'Alice');
      await user.click(screen.getByRole('button', { name: 'Rejoin as Alice' }));
      FakeWebSocket.instances[0].serverClose(1006);

      expect(await screen.findByRole('alert')).toHaveTextContent(takenMessage);
    });
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
        { id: 'ticket-1', type: 'story', title: 'Login page', description: 'As a user I log in', result: null },
        { id: 'ticket-2', type: 'story', title: 'Logout', description: '', result: null },
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

    it('uses ticket order for the scene, wrapping at ticket five and preserving it across rounds', async () => {
      const ws = await joinAs('user-b');
      const tickets = Array.from({ length: 5 }, (_, index) => ({
        id: `ticket-${index + 1}`,
        type: index === 1 ? 'spike' : 'story',
        title: `Ticket ${index + 1}`,
        description: '',
        result: null,
      }));
      const filenames = ['riverside.jpg', 'riverside-2.jpg', 'riverside-3.jpg', 'riverside-4.jpg', 'riverside.jpg'];
      for (const index of [0, 1, 2, 3, 4, 1, 0]) {
        ws.emit({ ...roomState(null), tickets, activeTicketId: tickets[index].id });
        const scene = document.querySelector('.room-layout > .room-mascot');
        expect(scene).toHaveAttribute('src', expect.stringContaining(filenames[index]));
        ws.emit({ ...roomState(null), tickets, activeTicketId: tickets[index].id, revealed: true, votes: {} });
        expect(scene).toHaveAttribute('src', expect.stringContaining(filenames[index]));
        ws.emit({ ...roomState(null), tickets, activeTicketId: tickets[index].id, round: 1 });
        expect(scene).toHaveAttribute('src', expect.stringContaining(filenames[index]));
      }

      ws.emit({ ...roomState(null), tickets, activeTicketId: null });
      expect(document.querySelector('.room-mascot')).not.toBeInTheDocument();
      expect(document.querySelector('.room-hero .mascot')).toHaveAttribute(
        'src', expect.stringContaining('riverside.jpg'),
      );
    });

    it('sends my vote, highlights the vote the server holds, and lets me change it', async () => {
      const ws = await joinAs('user-b');
      const user = userEvent.setup();
      expect(screen.getByText('Now voting:').parentElement).toHaveTextContent('Now voting: Login page');
      expect(document.querySelector('.room-layout > .room-mascot')).toHaveAttribute(
        'src', expect.stringContaining('riverside.jpg'),
      );

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

      await user.type(screen.getByLabelText('Ticket title'), 'Signup');
      await user.type(screen.getByLabelText('Ticket description (optional)'), 'With email');
      await user.click(screen.getByRole('button', { name: 'Add ticket' }));
      expect(screen.getByLabelText('Ticket title')).toHaveValue('Signup');

      const tickets = within(screen.getByRole('list', { name: 'Tickets' })).getAllByRole('listitem');
      expect(tickets[0]).toHaveAttribute('aria-current', 'true');
      expect(within(tickets[0]).queryByRole('button', { name: 'Start voting' })).not.toBeInTheDocument();
      expect(within(tickets[1]).getByRole('button', { name: 'Start voting' })).toHaveClass('accent');
      await user.click(within(tickets[1]).getByRole('button', { name: 'Start voting' }));

      await user.click(within(tickets[0]).getByRole('button', { name: 'Edit' }));
      const editor = within(tickets[0]).getByLabelText('Edit title');
      expect(editor).toHaveValue('Login page');
      expect(within(tickets[0]).getByLabelText('Edit description (optional)')).toHaveValue('As a user I log in');
      await user.clear(editor);
      await user.type(editor, 'Login with SSO');
      await user.click(within(tickets[0]).getByRole('button', { name: 'Save' }));

      await user.click(within(tickets[0]).getByRole('button', { name: 'Remove' }));
      await user.click(within(tickets[0]).getByRole('button', { name: 'Remove' }));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Login page'));

      expect(ws.sent).toEqual([
        { type: 'jira', requestId: 'jira-1', action: 'status' },
        { type: 'addTicket', ticket: { type: 'story', title: 'Signup', description: 'With email' } },
        { type: 'selectTicket', ticketId: 'ticket-2' },
        {
          type: 'editTicket',
          ticketId: 'ticket-1',
          title: 'Login with SSO',
          description: 'As a user I log in',
          ticketType: 'story',
        },
        { type: 'removeTicket', ticketId: 'ticket-1' },
      ]);
    });

    it('shows the ticket list read-only to participants and no active ticket after removal', async () => {
      const ws = await joinAs('user-b');
      const list = within(screen.getByRole('list', { name: 'Tickets' }));
      expect(list.getAllByRole('listitem').map((item) => item.querySelector('.ticket-content')?.textContent)).toEqual([
        'Login pageAs a user I log in',
        'Logout',
      ]);
      expect(list.getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent)).toEqual([
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

    it('lets a non-host expand and close the active ticket overlay purely as local view state', async () => {
      const ws = await joinAs('user-b');
      const user = userEvent.setup();
      const sentBefore = ws.sent.length;

      await user.click(within(screen.getByRole('region', { name: 'Current ticket' })).getByRole('button', { name: 'Expand' }));
      expect(await screen.findByRole('dialog', { name: 'Login page' })).toBeInTheDocument();
      expect(ws.sent).toHaveLength(sentBefore);

      await user.click(screen.getByRole('button', { name: 'Close ticket details' }));
      expect(screen.queryByRole('dialog', { name: 'Login page' })).not.toBeInTheDocument();
      expect(ws.sent).toHaveLength(sentBefore);
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
      await user.type(screen.getByLabelText('Ticket title'), 'Signup');
      await user.click(screen.getByRole('button', { name: 'Add ticket' }));
      ws.emit({ type: 'error', message: 'A room can have at most 10 tickets' });
      expect(screen.getByRole('alert')).toHaveTextContent('A room can have at most 10 tickets');
      expect(screen.getByLabelText('Ticket title')).toHaveValue('Signup');

      await user.click(screen.getByRole('button', { name: 'Add ticket' }));
      const base = roomState(null, 'user-b');
      ws.emit({ ...base, tickets: [...base.tickets, { id: 'ticket-3', type: 'story', title: 'Signup', description: '', result: null }] });
      expect(screen.getByLabelText('Ticket title')).toHaveValue('');
    });

    it('switches to the day deck while a spike ticket is active and shows results in days', async () => {
      const ws = await joinAs('user-b');
      const [first, second] = roomState(null).tickets;
      const spikeState = { ...roomState(null), tickets: [first, { ...second, type: 'spike' }], activeTicketId: 'ticket-2', round: 2 };
      ws.emit(spikeState);

      expect(screen.getByRole('heading', { name: 'Your vote (days)' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '13' })).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: '3 days' }));
      expect(ws.sent).toEqual([{ type: 'vote', value: '3', round: 2 }]);

      ws.emit({ ...spikeState, revealed: true, votes: { 'user-a': '3', 'user-b': '1' } });
      const meters = within(screen.getByRole('list', { name: 'Vote frequency' })).getAllByRole('meter');
      expect(meters.map((meter) => meter.getAttribute('aria-label'))).toEqual(['1 day: 1 vote', '3 days: 1 vote']);
      const rows = within(screen.getByRole('list', { name: 'Participant votes' })).getAllByRole('listitem');
      expect(rows.map((row) => row.textContent)).toEqual(['Alice3 days', 'Bob1 day']);

      ws.emit(roomState(null));
      expect(screen.getByRole('heading', { name: 'Your vote' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '13' })).toBeInTheDocument();
    });

    it('sends a type change for the active ticket from the host', async () => {
      const ws = await joinAs('user-b', 'user-b');
      const user = userEvent.setup();
      const [first] = within(screen.getByRole('list', { name: 'Tickets' })).getAllByRole('listitem');
      await user.click(within(first).getByRole('button', { name: 'Edit' }));
      await user.click(within(first).getByRole('radio', { name: 'Spike' }));
      await user.click(within(first).getByRole('button', { name: 'Save' }));
      expect(ws.sent).toEqual([
        { type: 'jira', requestId: 'jira-1', action: 'status' },
        {
          type: 'editTicket',
          ticketId: 'ticket-1',
          title: 'Login page',
          description: 'As a user I log in',
          ticketType: 'spike',
        },
      ]);
    });

    it('shows voting controls only to the current host and sends reveal/reset messages', async () => {
      const ws = await joinAs('user-b');
      expect(screen.queryByRole('button', { name: 'Reveal votes' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset votes' })).not.toBeInTheDocument();

      ws.emit(roomState(null, 'user-b'));
      const user = userEvent.setup();
      const revealButton = screen.getByRole('button', { name: 'Reveal votes' });
      expect(revealButton).toHaveClass('reveal');
      expect(revealButton.closest('section')).toHaveClass('voting-controls');
      await user.click(revealButton);
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

  describe('participating and spectating', () => {
    const roomState = (spectating: Record<string, boolean>, extra: object = {}) => ({
      type: 'state',
      hostId: 'user-a',
      revealed: false,
      tickets: [{ id: 'ticket-1', type: 'story', title: 'Login page', description: '', result: null }],
      activeTicketId: 'ticket-1',
      round: 0,
      users: [
        { id: 'user-a', name: 'Alice', hasVoted: false, spectating: spectating['user-a'] ?? false },
        { id: 'user-b', name: 'Bob', hasVoted: false, spectating: spectating['user-b'] ?? false },
      ],
      votes: null,
      myVote: null,
      ...extra,
    });

    async function joinAsBob() {
      mockRoomStatus({ exists: true, userCount: 1, capacity: 50, full: false });
      render(<RoomPage roomId={ROOM} />);
      await fillAndJoin('Bob', 'Penguin');
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const ws = FakeWebSocket.instances[0];
      ws.emit({ type: 'welcome', userId: 'user-b' });
      ws.emit(roomState({}));
      return ws;
    }

    it('switches me to spectating, hiding the deck until I switch back', async () => {
      const ws = await joinAsBob();
      const user = userEvent.setup();
      const toggle = screen.getByRole('switch', { name: 'Spectate' });
      expect(toggle).not.toBeChecked();
      expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();

      await user.click(toggle);
      expect(ws.sent).toEqual([{ type: 'setSpectating', spectating: true }]);
      ws.emit(roomState({ 'user-b': true }));
      expect(screen.getByRole('switch', { name: 'Spectate' })).toBeChecked();
      expect(screen.queryByRole('button', { name: '5' })).not.toBeInTheDocument();
      expect(screen.getByText("You're spectating — switch off to vote.")).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Bob (you)Spectating');

      await user.click(screen.getByRole('switch', { name: 'Spectate' }));
      expect(ws.sent.at(-1)).toEqual({ type: 'setSpectating', spectating: false });
      ws.emit(roomState({}));
      expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
    });

    it('still shows results to a spectator, leaving out spectators who did not vote', async () => {
      const ws = await joinAsBob();
      ws.emit(roomState({ 'user-b': true }, { revealed: true, votes: { 'user-a': '5' } }));
      const rows = within(screen.getByRole('list', { name: 'Participant votes' })).getAllByRole('listitem');
      expect(rows.map((row) => row.textContent)).toEqual(['Alice5']);

      ws.emit(roomState({ 'user-b': true }, { revealed: true, votes: { 'user-a': '5', 'user-b': '8' } }));
      const withVote = within(screen.getByRole('list', { name: 'Participant votes' })).getAllByRole('listitem');
      expect(withVote.map((row) => row.textContent)).toEqual(['Alice5', 'Bob8']);
    });

    it('keeps host controls for a spectating host, who can opt in to voting', async () => {
      const ws = await joinAsBob();
      ws.emit(roomState({ 'user-b': true }, { hostId: 'user-b' }));
      expect(screen.getByRole('switch', { name: 'Spectate' })).toBeChecked();
      expect(screen.queryByRole('button', { name: '5' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reveal votes' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset votes' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add ticket' })).toBeInTheDocument();

      await userEvent.setup().click(screen.getByRole('switch', { name: 'Spectate' }));
      expect(ws.sent).toEqual([
        { type: 'jira', requestId: 'jira-1', action: 'status' },
        { type: 'setSpectating', spectating: false },
      ]);
      ws.emit(roomState({}, { hostId: 'user-b' }));
      expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reveal votes' })).toBeInTheDocument();
    });

    it('hides voting cards until a ticket is active, with no placeholder in their place', async () => {
      const ws = await joinAsBob();
      ws.emit(roomState({}, { tickets: [], activeTicketId: null }));

      expect(screen.queryByRole('button', { name: '5' })).not.toBeInTheDocument();
      expect(screen.queryByText("You're spectating — switch off to vote.")).not.toBeInTheDocument();

      ws.emit(roomState({}));
      expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
    });
  });

  describe('room layout', () => {
    const state = (hostId: string) => ({
      type: 'state',
      hostId,
      revealed: false,
      tickets: [],
      activeTicketId: null,
      round: 0,
      users: [
        { id: 'user-a', name: 'Alice', hasVoted: false, spectating: true },
        { id: 'user-b', name: 'Bob', hasVoted: false, spectating: false },
      ],
      votes: null,
      myVote: null,
    });

    async function joinAsBob(hostId: string) {
      mockRoomStatus({ exists: true, userCount: 1, capacity: 50, full: false });
      render(<RoomPage roomId={ROOM} />);
      await fillAndJoin('Bob', 'Penguin');
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const ws = FakeWebSocket.instances[0];
      ws.emit({ type: 'welcome', userId: 'user-b' });
      ws.emit(state(hostId));
    }

    const sidebarBoxes = () =>
      Array.from(screen.getByRole('complementary', { name: 'Room' }).children).map(
        (box) => box.getAttribute('aria-label') ?? box.querySelector('h2')?.textContent,
      );

    it('orders the host sidebar as team link, voting controls, room members and spectate toggle', async () => {
      await joinAsBob('user-b');
      expect(sidebarBoxes()).toEqual(['Share this room', 'Jira', 'Voting controls', 'In the room (2)', 'Participation']);
    });

    it('keeps the same sidebar order for participants, without voting controls', async () => {
      await joinAsBob('user-a');
      expect(sidebarBoxes()).toEqual(['Share this room', 'In the room (2)', 'Participation']);
      expect(screen.queryByRole('region', { name: 'Add tickets' })).not.toBeInTheDocument();
    });

    it('places Add tickets below the ticket list, within the Tickets section', async () => {
      await joinAsBob('user-b');
      const ticketsSection = screen.getByRole('region', { name: 'Tickets' });
      const addTickets = within(ticketsSection).getByRole('region', { name: 'Add tickets' });
      expect(within(ticketsSection).getByText('No tickets added yet').nextElementSibling).toBe(addTickets);
      expect(within(addTickets).getByRole('button', { name: 'Add ticket' })).toHaveClass('primary');
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

    it('reconnects with the saved token instead of name and avatar', async () => {
      mockRoomStatus({ exists: false, userCount: 0, capacity: 50, full: false });
      render(<RoomPage roomId={ROOM} />);
      await fillAndJoin();
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      FakeWebSocket.instances[0].emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      FakeWebSocket.instances[0].emit(state);
      expect(localStorage.getItem(`ppk:session:${ROOM}`)).toBe(TOKEN);
      vi.useFakeTimers();
      FakeWebSocket.instances[0].serverClose(1006);
      expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();

      advance(reconnectDelay(0));
      expect(Object.fromEntries(new URL(FakeWebSocket.instances[1].url).searchParams)).toEqual({
        room: ROOM,
        token: TOKEN,
      });
    });
  });

  describe('restoring a saved session', () => {
    const state = {
      type: 'state',
      hostId: 'user-a',
      revealed: false,
      tickets: [],
      activeTicketId: null,
      round: 0,
      users: [{ id: 'user-a', name: 'Alice', avatar: 'capybara', hasVoted: false, spectating: false, away: false }],
      votes: null,
      myVote: null,
    };
    const votingState = {
      ...state,
      tickets: [{ id: 'ticket-1', type: 'story', title: 'Login page', description: '', result: null }],
      activeTicketId: 'ticket-1',
    };

    it('rejoins automatically without showing the join form', () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      const fetchMock = mockRoomStatus({ exists: true, userCount: 50, capacity: 50, full: true });
      render(<RoomPage roomId={ROOM} />);

      expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(FakeWebSocket.instances).toHaveLength(1);
      const ws = FakeWebSocket.instances[0];
      expect(Object.fromEntries(new URL(ws.url).searchParams)).toEqual({ room: ROOM, token: TOKEN });

      ws.emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      ws.emit(state);
      expect(screen.getByRole('listitem')).toHaveTextContent('Alice (you)Host');
    });

    it('forgets the saved session and shows the join form when the room has closed', () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      render(<RoomPage roomId={ROOM} />);
      FakeWebSocket.instances[0].serverClose(4001);

      expect(localStorage.getItem(`ppk:session:${ROOM}`)).toBeNull();
      expect(screen.getByLabelText('Your name')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('retries manually with the saved token without checking room capacity', async () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      const fetchMock = mockRoomStatus({ exists: true, userCount: 50, capacity: 50, full: true });
      vi.useFakeTimers();
      render(<RoomPage roomId={ROOM} />);
      FakeWebSocket.instances[0].serverClose(1006);
      for (let attempt = 1; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
        act(() => vi.advanceTimersByTime(reconnectDelay(attempt)));
        FakeWebSocket.instances.at(-1)!.serverClose(1006);
      }
      vi.useRealTimers();

      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't join — the room may be full or unavailable.");
      await fillAndJoin();

      expect(fetchMock).not.toHaveBeenCalled();
      const manualRetry = FakeWebSocket.instances.at(-1)!;
      expect(Object.fromEntries(new URL(manualRetry.url).searchParams)).toEqual({ room: ROOM, token: TOKEN });
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    });

    it('ignores a session saved for a different room', () => {
      localStorage.setItem('ppk:session:abcd-efgh', TOKEN);
      render(<RoomPage roomId={ROOM} />);

      expect(screen.getByLabelText('Your name')).toBeInTheDocument();
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('rejoins as the same member in a new tab while the first tab is told to stand down', () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      markCreator(ROOM);
      const fetchMock = mockRoomStatus({ exists: true, userCount: 1, capacity: 50, full: false });
      render(<RoomPage roomId={ROOM} />);
      const firstTab = FakeWebSocket.instances[0];
      firstTab.emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      firstTab.emit({ ...votingState, myVote: '5' });

      const secondTab = render(<RoomPage roomId={ROOM} />);
      expect(within(secondTab.container).queryByLabelText('Your name')).not.toBeInTheDocument();
      const ws = FakeWebSocket.instances[1];
      expect(Object.fromEntries(new URL(ws.url).searchParams)).toEqual({ room: ROOM, token: TOKEN });
      firstTab.emit({ type: 'replaced' });
      ws.emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      ws.emit({ ...votingState, myVote: '5' });

      expect(within(secondTab.container).getAllByRole('listitem')[0]).toHaveTextContent('Alice (you)Host');
      expect(within(secondTab.container).getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('This room was opened in another tab or window.')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('waits until a background tab is shown before taking over the session', () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      try {
        render(<RoomPage roomId={ROOM} />);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(FakeWebSocket.instances).toHaveLength(0);
        expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

        hidden.mockReturnValue(false);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        act(() => document.dispatchEvent(new Event('visibilitychange')));
      } finally {
        hidden.mockRestore();
      }

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(Object.fromEntries(new URL(FakeWebSocket.instances[0].url).searchParams)).toEqual({
        room: ROOM,
        token: TOKEN,
      });
    });

    it('does not connect from a prerendered page until it is opened', () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      Object.defineProperty(document, 'prerendering', { configurable: true, value: true });
      try {
        render(<RoomPage roomId={ROOM} />);
        expect(FakeWebSocket.instances).toHaveLength(0);

        Object.defineProperty(document, 'prerendering', { configurable: true, value: false });
        act(() => document.dispatchEvent(new Event('prerenderingchange')));
      } finally {
        delete (document as { prerendering?: boolean }).prerendering;
      }

      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('stops waiting to rejoin once the page is closed', () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      try {
        const { unmount } = render(<RoomPage roomId={ROOM} />);
        unmount();
        hidden.mockReturnValue(false);
        act(() => document.dispatchEvent(new Event('visibilitychange')));
      } finally {
        hidden.mockRestore();
      }

      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('stops when the room is opened in another tab and lets me take it back', async () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      vi.useFakeTimers();
      render(<RoomPage roomId={ROOM} />);
      const ws = FakeWebSocket.instances[0];
      ws.emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      ws.emit(state);
      ws.serverClose(4002);

      expect(screen.getByRole('alert')).toHaveTextContent('This room was opened in another tab or window.');
      expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(60_000));
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(localStorage.getItem(`ppk:session:${ROOM}`)).toBe(TOKEN);
      vi.useRealTimers();

      await userEvent.setup().click(screen.getByRole('button', { name: 'Use this tab instead' }));
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(Object.fromEntries(new URL(FakeWebSocket.instances[1].url).searchParams)).toEqual({
        room: ROOM,
        token: TOKEN,
      });
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    });

    it('stops immediately on a replacement message even if the close code is lost', async () => {
      localStorage.setItem(`ppk:session:${ROOM}`, TOKEN);
      vi.useFakeTimers();
      render(<RoomPage roomId={ROOM} />);
      const ws = FakeWebSocket.instances[0];
      const close = vi.spyOn(ws, 'close');
      ws.emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      ws.emit(state);
      ws.emit({ type: 'replaced' });

      expect(screen.getByRole('alert')).toHaveTextContent('This room was opened in another tab or window.');
      expect(close).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: 'Reveal votes' })).not.toBeInTheDocument();

      ws.emit(state);
      ws.serverClose(1006);
      act(() => vi.advanceTimersByTime(60_000));
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(screen.getByRole('alert')).toHaveTextContent('This room was opened in another tab or window.');
      expect(localStorage.getItem(`ppk:session:${ROOM}`)).toBe(TOKEN);
      vi.useRealTimers();

      await userEvent.setup().click(screen.getByRole('button', { name: 'Use this tab instead' }));
      const resumed = FakeWebSocket.instances[1];
      resumed.emit({ type: 'welcome', userId: 'user-a', token: TOKEN });
      resumed.emit({ ...votingState, myVote: '5' });
      ws.emit({ type: 'replaced' });
      ws.emit({ ...votingState, myVote: '8' });
      ws.serverClose(4002);

      expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
