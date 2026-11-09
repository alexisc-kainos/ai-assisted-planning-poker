import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomPage } from '../RoomPage';
import { JIRA_REQUEST_TIMEOUT_MS, useRoom } from '../useRoom';
import type { ClientMessage, JiraClientMessage, JiraResult, JiraStatus, RoomState, RoomTicket } from '../types';

const ROOM = 'jira-room';
const site = { id: 'cloud-1', name: 'Team Jira', url: 'https://team.atlassian.net' };
const connected: JiraStatus = { available: true, connected: true, site };
const linked: RoomTicket = {
  id: 'ticket-1', type: 'story', title: 'Imported story', description: 'Plain fallback', revision: 1,
  jira: { cloudId: site.id, issueId: '10001', key: 'PPK-1', url: `${site.url}/browse/PPK-1` },
  descriptionAdf: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich description' }] }] },
  result: { users: [{ id: 'host', name: 'Alice' }], votes: { host: '5' } },
};
const roomState: RoomState = {
  type: 'state', hostId: 'host', revealed: true, round: 1, activeTicketId: linked.id,
  tickets: [linked], users: [{ id: 'host', name: 'Alice', hasVoted: true, away: false, spectating: false }],
  votes: { host: '5' }, myVote: '5',
};
const preview = {
  id: 'one-use-confirmation', issueKey: 'PPK-1', issueUrl: linked.jira!.url, siteName: site.name,
  fieldId: 'customfield_10', fieldName: 'Story points', currentPoints: 3, points: 8,
};

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  sent: ClientMessage[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  emit(message: unknown) { act(() => this.onmessage?.({ data: JSON.stringify(message) })); }
  requests(action?: JiraClientMessage['action']) {
    return this.sent.filter((message): message is JiraClientMessage => message.type === 'jira' && (!action || message.action === action));
  }
}

function start(state = roomState, userId = 'host') {
  const view = render(<RoomPage roomId={ROOM} />);
  const ws = Socket.instances[0];
  ws.emit({ type: 'welcome', userId, token: 'session-token' });
  ws.emit(state);
  return { ws, ...view };
}

async function reply(ws: Socket, action: JiraClientMessage['action'], data: JiraResult = {}, error?: string) {
  const request = ws.requests(action).at(-1)!;
  expect(request).toBeDefined();
  await act(async () => ws.emit({ type: 'jira', requestId: request.requestId, ok: !error, data, error }));
}

async function ready(state = roomState) {
  const view = start(state);
  await reply(view.ws, 'status', { status: connected });
  return view;
}

function agreedState(): RoomState {
  return { ...roomState, tickets: [{ ...linked, agreedEstimate: 8 }] };
}

async function openPreview(ws: Socket) {
  fireEvent.click(screen.getByRole('button', { name: 'Update Jira' }));
  await reply(ws, 'prepare', { preview });
  return screen.getByRole('dialog', { name: 'Confirm Jira estimate' });
}

describe('Jira room workflow', () => {
  beforeEach(() => {
    Socket.instances = [];
    vi.stubGlobal('WebSocket', Socket);
    localStorage.setItem(`ppk:session:${ROOM}`, 'session-token');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('requests availability only after the current member is known to be host', async () => {
    render(<RoomPage roomId={ROOM} />);
    const ws = Socket.instances[0];
    ws.emit(roomState);
    expect(ws.requests()).toEqual([]);
    ws.emit({ type: 'welcome', userId: 'host', token: 'session-token' });
    expect(ws.requests()).toEqual([{ type: 'jira', action: 'status', requestId: 'jira-1' }]);
    await reply(ws, 'status', { status: { available: false, connected: false, reason: 'Jira is not configured.' } });
    expect(screen.getByText('Jira is not configured.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Jira' })).not.toBeInTheDocument();
  });

  it('keeps private Jira controls away from members but displays linked read-only rich content to everyone', () => {
    const { ws } = start(roomState, 'member');
    expect(ws.requests()).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Jira' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'PPK-1' })).toHaveLength(2);
    expect(screen.getAllByText('Rich description')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('keeps remove/start controls on imports and leaves manual ticket editing available', async () => {
    await ready({ ...roomState, activeTicketId: null, tickets: [linked, { id: 'manual', title: 'Manual', description: '', type: 'story', result: null }] });
    const items = within(screen.getByRole('list', { name: 'Tickets' })).getAllByRole('listitem');
    expect(within(items[0]).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(items[0]).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(items[0]).getByRole('button', { name: 'Start voting' })).toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('opens the popup synchronously, navigates only to the backend URL, and receives OAuth site status privately', async () => {
    const popup = { location: { href: 'about:blank' }, close: vi.fn(), closed: false, opener: {} };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const originalUrl = window.location.href;
    const { ws } = start();
    await reply(ws, 'status', { status: { available: true, connected: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe('about:blank');
    const authorizeUrl = 'http://localhost:3000/jira/authorize/one-use';
    await reply(ws, 'connect', { authorizeUrl, status: { available: true, connected: false } });
    expect(popup.location.href).toBe(authorizeUrl);
    expect(popup.close).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalUrl);
    const other = { ...site, id: 'cloud-2', name: 'Second Jira' };
    ws.emit({ type: 'jiraStatus', status: { available: true, connected: false, sites: [site, other] } });
    expect(popup.close).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Jira site'), { target: { value: other.id } });
    expect(ws.requests('selectSite').at(-1)).toMatchObject({ action: 'selectSite', siteId: other.id });
    await reply(ws, 'selectSite', { status: { ...connected, site: other } });
    expect(screen.getByText('Connected to Second Jira')).toBeInTheDocument();
  });

  it('offers an explicit new-tab link when the authorization popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { ws } = start();
    await reply(ws, 'status', { status: { available: true, connected: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    await reply(ws, 'connect', { authorizeUrl: 'https://api.example.com/jira/authorize/once' });
    const link = screen.getByRole('link', { name: 'Continue Jira connection in a new tab' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', 'https://api.example.com/jira/authorize/once');
    ws.emit({ type: 'jiraStatus', status: connected });
    expect(link).not.toBeInTheDocument();
  });

  it('returns OAuth to the app path with only the room parameter', async () => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, '', '/planning/poker?room=jira-room&token=secret&other=value#private');
    vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      const { ws } = start();
      await reply(ws, 'status', { status: { available: true, connected: false } });
      fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
      expect(ws.requests('connect').at(-1)).toMatchObject({
        action: 'connect', returnUrl: `${window.location.origin}/planning/poker?room=jira-room`,
      });
      await reply(ws, 'connect', { authorizeUrl: 'https://api.example.com/jira/authorize/once' });
    } finally {
      window.history.replaceState(null, '', originalUrl);
    }
  });

  it('rejects unsafe authorization URLs and closes the unused popup', async () => {
    const popup = { location: { href: 'about:blank' }, close: vi.fn(), closed: false, opener: {} };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const { ws } = start();
    await reply(ws, 'status', { status: { available: true, connected: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    await reply(ws, 'connect', { authorizeUrl: 'javascript:alert(1)' });
    expect(screen.getByRole('alert')).toHaveTextContent('valid authorization URL');
    expect(popup.location.href).toBe('about:blank');
    expect(popup.close).toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Continue Jira connection in a new tab' })).not.toBeInTheDocument();
  });

  it('imports URL/key input through the server and retains the draft and local results on rejection', async () => {
    const { ws } = await ready();
    fireEvent.change(screen.getByLabelText('Jira issue URL or key'), { target: { value: ' PPK-2 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import issue' }));
    expect(ws.requests('import').at(-1)).toMatchObject({ action: 'import', input: 'PPK-2' });
    await reply(ws, 'import', {}, 'Unsupported issue type');
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported issue type');
    expect(screen.getByLabelText('Jira issue URL or key')).toHaveValue(' PPK-2 ');
    expect(screen.getByRole('button', { name: 'Show results' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import issue' }));
    await reply(ws, 'import', { ticketId: 'imported-2' });
    expect(screen.getByLabelText('Jira issue URL or key')).toHaveValue('');
    expect(screen.queryByText('New imported spike')).not.toBeInTheDocument();
    ws.emit({ ...roomState, tickets: [...roomState.tickets, { ...linked, id: 'imported-2', title: 'New imported spike', type: 'spike' }] });
    expect(screen.getByText('New imported spike')).toBeInTheDocument();
  });

  it('debounces key prefixes, normalizes case, and never suggests URLs or bare text', async () => {
    vi.useFakeTimers();
    const { ws } = await ready();
    const input = screen.getByRole('combobox', { name: 'Jira issue URL or key' });
    for (const value of ['AL', 'some text', `${site.url}/browse/AL-1`, `A${'L'.repeat(64)}-`]) {
      fireEvent.change(input, { target: { value } });
      await act(async () => vi.advanceTimersByTimeAsync(300));
    }
    expect(ws.requests('suggest')).toEqual([]);
    fireEvent.change(input, { target: { value: ' al- ' } });
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(ws.requests('suggest')).toEqual([]);
    fireEvent.change(input, { target: { value: ' al-1 ' } });
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(ws.requests('suggest')).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(ws.requests('suggest')).toHaveLength(1);
    expect(ws.requests('suggest')[0]).toMatchObject({ action: 'suggest', query: 'AL-1' });
    expect(screen.getByText('Finding Jira issues...')).toBeInTheDocument();
    await reply(ws, 'suggest', { suggestions: [{ key: 'AL-12', summary: '<b>Plain summary</b>' }] });
    const option = screen.getByRole('option', { name: 'AL-12 <b>Plain summary</b>' });
    expect(option.querySelector('b')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toHaveAttribute('id', input.getAttribute('aria-controls'));
  });

  it.each(['keyboard', 'pointer'])('selects by %s without importing or searching the selected key again', async (method) => {
    vi.useFakeTimers();
    const { ws } = await ready();
    const input = screen.getByLabelText('Jira issue URL or key');
    fireEvent.change(input, { target: { value: 'AL-' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await reply(ws, 'suggest', { suggestions: [
      { key: 'AL-1', summary: 'First issue' }, { key: 'AL-2', summary: 'Second issue' },
    ] });
    if (method === 'keyboard') {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'AL-1 First issue' }).id);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      fireEvent.keyDown(input, { key: 'Enter' });
    } else {
      const option = screen.getByRole('option', { name: 'AL-1 First issue' });
      fireEvent.mouseDown(option);
      fireEvent.click(option);
    }
    expect(input).toHaveValue('AL-1');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(ws.requests('import')).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(ws.requests('suggest')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Import issue' }));
    expect(ws.requests('import').at(-1)).toMatchObject({ action: 'import', input: 'AL-1' });
    await reply(ws, 'import', { ticketId: 'new-ticket' });
  });

  it.each(['Escape', 'blur'])('dismisses suggestions on %s and permits a new query', async (method) => {
    vi.useFakeTimers();
    const { ws } = await ready();
    const input = screen.getByLabelText('Jira issue URL or key');
    fireEvent.change(input, { target: { value: 'AL-' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await reply(ws, 'suggest', { suggestions: [{ key: 'AL-1', summary: 'First issue' }] });
    if (method === 'Escape') fireEvent.keyDown(input, { key: 'Escape' });
    else fireEvent.blur(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('AL-');
    fireEvent.change(input, { target: { value: 'AL-2' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await reply(ws, 'suggest', { suggestions: [{ key: 'AL-2', summary: 'New issue' }] });
    expect(screen.getByRole('option', { name: 'AL-2 New issue' })).toBeInTheDocument();
    expect(ws.requests('import')).toEqual([]);
  });

  it.each(['query', 'site', 'disconnect', 'host', 'room', 'unmount', 'Escape', 'blur'])(
    'ignores pending suggestions after %s changes', async (change) => {
      vi.useFakeTimers();
      const { ws, rerender, unmount } = await ready();
      const input = screen.getByLabelText('Jira issue URL or key');
      fireEvent.change(input, { target: { value: 'AL-' } });
      await act(async () => vi.advanceTimersByTimeAsync(300));
      if (change === 'query') fireEvent.change(input, { target: { value: 'AL-2' } });
      else if (change === 'site') ws.emit({ type: 'jiraStatus', status: { ...connected, site: { ...site, id: 'other' } } });
      else if (change === 'disconnect') ws.emit({ type: 'jiraStatus', status: { available: true, connected: false } });
      else if (change === 'host') ws.emit({ ...roomState, hostId: 'other' });
      else if (change === 'room') rerender(<RoomPage roomId="other-room" />);
      else if (change === 'unmount') unmount();
      else if (change === 'Escape') fireEvent.keyDown(input, { key: 'Escape' });
      else fireEvent.blur(input);
      await reply(ws, 'suggest', { suggestions: [{ key: 'AL-1', summary: 'Stale issue' }] });
      expect(screen.queryByRole('option', { name: 'AL-1 Stale issue' })).not.toBeInTheDocument();
      if (change === 'query') {
        await act(async () => vi.advanceTimersByTimeAsync(300));
        await reply(ws, 'suggest', { suggestions: [{ key: 'AL-2', summary: 'Fresh issue' }] });
        expect(screen.getByRole('option', { name: 'AL-2 Fresh issue' })).toBeInTheDocument();
      }
    },
  );

  it.each(['Escape', 'blur', 'unmount', 'site', 'disconnect'])('cleans the debounce timer on %s', async (change) => {
    vi.useFakeTimers();
    const { ws, unmount } = await ready();
    const input = screen.getByLabelText('Jira issue URL or key');
    fireEvent.change(input, { target: { value: 'AL-' } });
    if (change === 'unmount') unmount();
    else if (change === 'site') ws.emit({ type: 'jiraStatus', status: { ...connected, site: { ...site, id: 'other' } } });
    else if (change === 'disconnect') ws.emit({ type: 'jiraStatus', status: { available: true, connected: false } });
    else if (change === 'Escape') fireEvent.keyDown(input, { key: 'Escape' });
    else fireEvent.blur(input);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(ws.requests('suggest')).toEqual([]);
  });

  it('treats missing suggestions as empty and keeps manual import usable after search errors', async () => {
    vi.useFakeTimers();
    const { ws } = await ready();
    const input = screen.getByLabelText('Jira issue URL or key');
    fireEvent.change(input, { target: { value: 'AL-' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await reply(ws, 'suggest');
    expect(screen.getByText('No matching Jira issues.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'AL-2' } });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await reply(ws, 'suggest', {}, 'Read cancelled');
    expect(screen.getByText('Jira suggestions unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import issue' })).toBeEnabled();
    fireEvent.submit(input.closest('form')!);
    expect(ws.requests('import').at(-1)).toMatchObject({ action: 'import', input: 'AL-2' });
    await reply(ws, 'import', { ticketId: 'new-ticket' });
  });

  it.each([
    { votes: { host: '8', second: '8', third: '5' }, selected: '8' },
    { votes: { host: '20', second: '20', third: '13' }, selected: '20' },
    { votes: { host: '3', second: '5' }, selected: '' },
    { votes: {}, selected: '' },
    { votes: { host: '\u2615' }, selected: '' },
    { votes: { host: '\u2615', second: '8', third: 'unexpected' }, selected: '8' },
    { votes: { host: '3', second: '3', third: '5', fourth: '8' }, selected: '3' },
  ])('prefills a unique most-common numeric vote without sending Jira actions: $selected', async ({ votes, selected }) => {
    const { ws } = await ready({ ...roomState,
      tickets: [{ ...linked, result: { ...linked.result!, votes: votes as Record<string, string> } }],
    });
    expect(screen.getByLabelText('Story points')).toHaveValue(selected);
    const button = screen.getByRole('button', { name: 'Update Jira' });
    if (selected) expect(button).toBeEnabled();
    else expect(button).toBeDisabled();
    for (const action of ['agree', 'prepare', 'confirm'] as const) expect(ws.requests(action)).toHaveLength(0);
  });

  it('keeps an existing explicit agreement instead of replacing it with the voting default', async () => {
    await ready(agreedState());
    expect(screen.getByLabelText('Story points')).toHaveValue('8');
  });

  it.each(['before', 'after'])('keeps the combined update alive when its agreement broadcast arrives %s the preview', async (timing) => {
    const { ws } = await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Update Jira' }));
    expect(ws.requests('agree').at(-1)).toMatchObject({ points: 5 });
    await reply(ws, 'agree', { ticketId: linked.id });
    expect(ws.requests('prepare')).toHaveLength(1);
    const agreement = { ...roomState, tickets: [{ ...linked, agreedEstimate: 5, revision: 2 }] };
    if (timing === 'before') ws.emit(agreement);
    await reply(ws, 'prepare', { preview: { ...preview, points: 5 } });
    if (timing === 'after') ws.emit(agreement);
    expect(screen.getByRole('dialog', { name: 'Confirm Jira estimate' })).toBeInTheDocument();
    expect(screen.getByLabelText('Story points')).toHaveValue('5');
    expect(ws.requests('confirm')).toHaveLength(0);
  });

  it('does not prepare an update when saving the chosen agreement fails', async () => {
    const { ws } = await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Update Jira' }));
    await reply(ws, 'agree', {}, 'Only the host can agree an estimate');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the local agreement');
    expect(screen.getByRole('button', { name: 'Update Jira' })).toBeEnabled();
    expect(ws.requests('prepare')).toHaveLength(0);
    expect(ws.requests('confirm')).toHaveLength(0);
  });

  it('uses the new round\'s majority but preserves a manual choice during unrelated room updates', async () => {
    const { ws } = await ready();
    fireEvent.change(screen.getByLabelText('Story points'), { target: { value: '13' } });
    ws.emit({ ...roomState, users: [...roomState.users, { id: 'guest', name: 'Guest', away: false, hasVoted: false, spectating: true }] });
    expect(screen.getByLabelText('Story points')).toHaveValue('13');
    ws.emit({ ...roomState, round: 2, tickets: [{ ...linked,
      result: { ...linked.result!, votes: { host: '8', guest: '8' } }, revision: 3,
    }] });
    expect(screen.getByLabelText('Story points')).toHaveValue('8');
  });

  it('ignores a preview if an external agreement revision changes while preparing', async () => {
    const { ws } = await ready(agreedState());
    fireEvent.click(screen.getByRole('button', { name: 'Update Jira' }));
    ws.emit({ ...agreedState(), tickets: [{ ...linked, agreedEstimate: 13, revision: 2 }] });
    await reply(ws, 'prepare', { preview });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(ws.requests('confirm')).toHaveLength(0);
  });

  it('uses one Update Jira button to agree points and prepare confirmation, including ambiguous field selection', async () => {
    const { ws } = await ready();
    const points = screen.getByLabelText('Story points');
    expect(within(points).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose points', '1', '2', '3', '5', '8', '13', '20']);
    expect(points).toHaveValue('5');
    expect(screen.queryByRole('button', { name: 'Save agreement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Jira update' })).not.toBeInTheDocument();
    fireEvent.change(points, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Jira' }));
    expect(ws.requests('agree').at(-1)).toMatchObject({ action: 'agree', ticketId: linked.id, points: 8 });
    await reply(ws, 'agree', { ticketId: linked.id });
    expect(ws.requests('prepare').at(-1)).toMatchObject({ action: 'prepare', ticketId: linked.id });
    expect(screen.getByRole('button', { name: 'Update Jira' })).toBeDisabled();
    ws.emit({ ...agreedState(), tickets: [{ ...linked, agreedEstimate: 8, revision: 2 }] });
    await reply(ws, 'prepare', { fields: [{ id: preview.fieldId, name: preview.fieldName }, { id: 'other', name: 'Alternative' }] });
    expect(screen.getByRole('button', { name: 'Update Jira' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Jira estimate field'), { target: { value: preview.fieldId } });
    const dialog = await openPreview(ws);
    expect(ws.requests('prepare').at(-1)).toMatchObject({ action: 'prepare', ticketId: linked.id, fieldId: preview.fieldId });
    for (const text of [site.name, 'PPK-1', 'Story points (customfield_10)', '3', '8']) expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(ws.requests('confirm')).toEqual([]);
    await openPreview(ws);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm write to Jira' }));
    expect(ws.requests('confirm')).toEqual([{ type: 'jira', requestId: expect.any(String), action: 'confirm', confirmationId: preview.id }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await reply(ws, 'confirm', { written: true });
    expect(screen.getByRole('status')).toHaveTextContent('Jira updated successfully: PPK-1 is now 8 story points.');
  });

  it('traps dialog keyboard focus and supports Escape cancellation', async () => {
    const { ws } = await ready(agreedState());
    const dialog = await openPreview(ws);
    const confirm = within(dialog).getByRole('button', { name: 'Confirm write to Jira' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(within(dialog).getByRole('link')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Jira' })).toHaveFocus();
    expect(ws.requests('confirm')).toEqual([]);
  });

  it.each(['round', 'active', 'revision', 'agreement', 'connection', 'site', 'host', 'reveal', 'result'])(
    'discards a preview when %s changes', async (change) => {
      const state = agreedState();
      const { ws } = await ready(state);
      await openPreview(ws);
      if (change === 'connection') ws.emit({ type: 'jiraStatus', status: { available: true, connected: false } });
      else if (change === 'site') ws.emit({ type: 'jiraStatus', status: { ...connected, site: { ...site, id: 'other' } } });
      else ws.emit({ ...state,
        ...(change === 'round' ? { round: 2 } : {}),
        ...(change === 'active' ? { activeTicketId: null } : {}),
        ...(change === 'host' ? { hostId: 'other' } : {}),
        ...(change === 'reveal' ? { revealed: false } : {}),
        tickets: [{ ...state.tickets[0],
          ...(change === 'revision' ? { revision: 2 } : {}),
          ...(change === 'agreement' ? { agreedEstimate: 13 } : {}),
          ...(change === 'result' ? { result: null } : {}),
        }],
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(ws.requests('confirm')).toEqual([]);
    },
  );

  it('ignores a prepare response from an earlier round', async () => {
    const { ws } = await ready(agreedState());
    fireEvent.click(screen.getByRole('button', { name: 'Update Jira' }));
    ws.emit({ ...agreedState(), round: 2 });
    await reply(ws, 'prepare', { preview });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([false, true])('reports uncertain outcomes without success or retries (error response: %s)', async (failed) => {
    const { ws } = await ready(agreedState());
    await openPreview(ws);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm write to Jira' }));
    await reply(ws, 'confirm', { uncertain: true, written: true }, failed ? 'Upstream timeout' : undefined);
    expect(screen.getByRole('alert')).toHaveTextContent(/uncertain/);
    expect(screen.queryByText(/Jira updated successfully/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show results' })).toBeInTheDocument();
    expect(screen.getByText('Saved agreement: 8')).toBeInTheDocument();
    expect(ws.requests('confirm')).toHaveLength(1);
  });

  it('keeps write failures visible when token expiry removes the estimate controls', async () => {
    const { ws } = await ready(agreedState());
    await openPreview(ws);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm write to Jira' }));
    expect(screen.getByRole('status')).toHaveTextContent('Updating PPK-1 in Jira...');
    ws.emit({ type: 'jiraStatus', status: { available: true, connected: false, reason: 'Jira authorisation expired.' } });
    expect(screen.queryByRole('button', { name: 'Update Jira' })).not.toBeInTheDocument();
    await reply(ws, 'confirm', {}, 'Jira authorisation expired. Reauthorise to continue.');
    expect(screen.getByRole('alert')).toHaveTextContent('Jira update failed for PPK-1: Jira authorisation expired.');
    expect(screen.getByRole('alert')).toHaveTextContent('Your saved estimate is kept.');
    expect(screen.queryByText(/Jira updated successfully/)).not.toBeInTheDocument();
    expect(ws.requests('confirm')).toHaveLength(1);
  });

  it('keeps verified success visible after switching tickets or disconnecting Jira', async () => {
    const { ws } = await ready(agreedState());
    await openPreview(ws);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm write to Jira' }));
    await reply(ws, 'confirm', { written: true });
    ws.emit({ ...agreedState(), activeTicketId: null, round: 2 });
    ws.emit({ type: 'jiraStatus', status: { available: true, connected: false } });
    expect(screen.getByRole('status')).toHaveTextContent('Jira updated successfully: PPK-1 is now 8 story points.');
    expect(screen.queryByRole('button', { name: 'Update Jira' })).not.toBeInTheDocument();
  });

  it.each([
    ['permission denied', 'Jira update failed for PPK-1: permission denied'],
    ['Jira request timed out. Outcome may be unknown.', 'Jira update for PPK-1 could not be verified'],
  ])('reports %s without claiming success or retrying', async (failure, expected) => {
    const { ws } = await ready(agreedState());
    await openPreview(ws);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm write to Jira' }));
    await reply(ws, 'confirm', {}, failure);
    expect(screen.getByRole('alert')).toHaveTextContent(expected);
    expect(screen.queryByText(/Jira updated successfully/)).not.toBeInTheDocument();
    expect(screen.getByText('Saved agreement: 8')).toBeInTheDocument();
    expect(ws.requests('confirm')).toHaveLength(1);
  });

  it('does not report success for a response without a verified write outcome', async () => {
    const { ws } = await ready(agreedState());
    await openPreview(ws);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm write to Jira' }));
    await reply(ws, 'confirm', {});
    expect(screen.getByRole('alert')).toHaveTextContent('Jira update for PPK-1 could not be verified');
    expect(screen.queryByText(/Jira updated successfully/)).not.toBeInTheDocument();
  });

  it.each([
    { type: 'spike' as const, result: linked.result, revealed: true },
    { type: 'story' as const, result: null, revealed: true },
    { type: 'story' as const, result: linked.result, revealed: false },
  ])('does not offer writes for ineligible tickets: %j', async ({ type, result, revealed }) => {
    await ready({ ...roomState, revealed, tickets: [{ ...linked, type, result }] });
    expect(screen.queryByLabelText('Story points')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update Jira' })).not.toBeInTheDocument();
  });

  it('disconnects without altering imported tickets or their results', async () => {
    const { ws } = await ready(agreedState());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Jira' }));
    await reply(ws, 'disconnect', { status: { available: true, connected: false } });
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getAllByText('Rich description')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show results' })).toBeInTheDocument();
  });

  it('can disconnect before selecting an authorised site', async () => {
    const { ws } = start();
    await reply(ws, 'status', { status: { available: true, connected: false, sites: [site] } });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Jira' }));
    await reply(ws, 'disconnect', { status: { available: true, connected: false } });
    expect(screen.queryByLabelText('Jira site')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect Jira' })).not.toBeInTheDocument();
  });

  it('disconnects a pending consent popup and clears its authorisation link', async () => {
    const popup = { location: { href: 'about:blank' }, close: vi.fn(), closed: false, opener: {} };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const { ws } = start();
    await reply(ws, 'status', { status: { available: true, connected: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
    await reply(ws, 'connect', { authorizeUrl: 'https://backend.example/jira/oauth/start?code=one-use' });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Jira' }));
    expect(popup.close).toHaveBeenCalled();
    await reply(ws, 'disconnect', { status: { available: true, connected: false } });
    expect(screen.queryByRole('button', { name: 'Disconnect Jira' })).not.toBeInTheDocument();
  });
});

describe('private Jira request lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Socket.instances = [];
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ members: [] }) }));
    localStorage.setItem(`ppk:session:${ROOM}`, 'session-token');
  });
  afterEach(() => vi.useRealTimers());

  function hook() {
    const view = renderHook(() => useRoom(ROOM));
    const ws = Socket.instances[0];
    ws.emit({ type: 'welcome', userId: 'member', token: 'session-token' });
    ws.emit(roomState);
    return { ...view, ws };
  }

  it('correlates concurrent requests out of order and ignores unsolicited response IDs', async () => {
    const { result, ws } = hook();
    const first = result.current.jiraRequest({ action: 'import', input: 'PPK-1' });
    const second = result.current.jiraRequest({ action: 'prepare', ticketId: linked.id });
    ws.emit({ type: 'jira', requestId: 'unknown', ok: true, data: { status: connected } });
    expect(result.current.jiraStatus).toBeNull();
    await reply(ws, 'prepare', { preview });
    await expect(second).resolves.toEqual({ preview });
    await reply(ws, 'import', { ticketId: linked.id });
    await expect(first).resolves.toEqual({ ticketId: linked.id });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds timeouts, never retries, and ignores late replies', async () => {
    const { result, ws } = hook();
    const pending = result.current.jiraRequest({ action: 'confirm', confirmationId: preview.id });
    const rejection = expect(pending).rejects.toThrow('Outcome may be unknown');
    await act(async () => vi.advanceTimersByTimeAsync(JIRA_REQUEST_TIMEOUT_MS));
    await rejection;
    await reply(ws, 'confirm', { written: true, status: connected });
    expect(result.current.jiraStatus).toBeNull();
    expect(ws.requests('confirm')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects pending requests on host loss and ignores their late status data', async () => {
    const { result, ws } = hook();
    ws.emit({ ...roomState, hostId: 'member' });
    await reply(ws, 'status', { status: connected });
    const pending = result.current.jiraRequest({ action: 'prepare', ticketId: linked.id });
    const rejection = expect(pending).rejects.toThrow('Connection changed');
    ws.emit(roomState);
    await rejection;
    await reply(ws, 'prepare', { status: connected, preview });
    expect(result.current.jiraStatus).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['replacement', 'close', 'unmount'])('rejects pending requests and clears timers on %s', async (change) => {
    const { result, ws, unmount } = hook();
    const pending = result.current.jiraRequest({ action: 'prepare', ticketId: linked.id });
    const rejection = expect(pending).rejects.toThrow('Connection changed');
    if (change === 'replacement') ws.emit({ type: 'replaced' });
    else if (change === 'close') act(() => ws.onclose?.({ code: 4001 }));
    else unmount();
    await rejection;
    expect(vi.getTimerCount()).toBe(change === 'close' ? 1 : 0);
    expect(ws.requests('prepare')).toHaveLength(1);
  });
});