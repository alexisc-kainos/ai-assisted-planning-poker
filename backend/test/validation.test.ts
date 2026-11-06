import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { isValidRoomId, parseClientMessage, parseConnectParams } from '../src/validation.js';

describe('isValidRoomId', () => {
  it.each(['abcd', 'xk29-4plm', 'a1b2c3d4-e5f6-g7h8', 'a'.repeat(32)])('accepts %s', (id) => {
    expect(isValidRoomId(id)).toBe(true);
  });

  it.each(['', 'abc', 'ABCD', 'abcd-', '-abcd', 'abcd--efgh', 'abcd-efg', 'ab cd', 'a'.repeat(33)])(
    'rejects %j',
    (id) => {
      expect(isValidRoomId(id)).toBe(false);
    },
  );

  it('rejects ids longer than 128 chars', () => {
    const segment = 'a'.repeat(32);
    expect(isValidRoomId([segment, segment, segment, segment].join('-'))).toBe(false);
    expect(isValidRoomId([segment, segment, segment, 'a'.repeat(29)].join('-'))).toBe(true);
  });
});

describe('parseConnectParams', () => {
  const parse = (params: Record<string, string>) => parseConnectParams(new URLSearchParams(params));

  it('trims name, deck and avatar', () => {
    expect(parse({ room: 'abcd', name: '  Alice ', deck: ' fibonacci ', avatar: ' cat ' })).toEqual({
      room: 'abcd',
      name: 'Alice',
      deck: 'fibonacci',
      avatar: 'cat',
    });
  });

  it('treats blank deck and avatar as absent', () => {
    expect(parse({ room: 'abcd', name: 'Bob', deck: '  ', avatar: '' })).toEqual({
      room: 'abcd',
      name: 'Bob',
      deck: undefined,
      avatar: undefined,
    });
  });

  it.each([
    [{ name: 'Bob' }],
    [{ room: 'bad', name: 'Bob' }],
    [{ room: 'abcd' }],
    [{ room: 'abcd', name: '   ' }],
    [{ room: 'abcd', name: 'x'.repeat(33) }],
    [{ room: 'abcd', name: 'Bob', deck: 'd'.repeat(33) }],
    [{ room: 'abcd', name: 'Bob', avatar: 'a'.repeat(33) }],
  ])('rejects %j', (params) => {
    expect(parse(params as Record<string, string>)).toBeNull();
  });

  it('accepts a 32 character name', () => {
    expect(parse({ room: 'abcd', name: 'x'.repeat(32) })).toMatchObject({ name: 'x'.repeat(32) });
  });

  it('reads spectating=1 as spectating and omits it when absent', () => {
    expect(parse({ room: 'abcd', name: 'Bob', spectating: '1' })).toMatchObject({ spectating: true });
    expect(parse({ room: 'abcd', name: 'Bob' })).not.toHaveProperty('spectating');
  });

  it.each(['0', 'true', ''])('rejects spectating=%j', (spectating) => {
    expect(parse({ room: 'abcd', name: 'Bob', spectating })).toBeNull();
  });

  it('reads takeover=1 and omits it when absent', () => {
    expect(parse({ room: 'abcd', name: ' Bob ', takeover: '1' })).toMatchObject({ name: 'Bob', takeover: true });
    expect(parse({ room: 'abcd', name: 'Bob' })).not.toHaveProperty('takeover');
  });

  it.each(['0', 'true', ''])('rejects takeover=%j', (takeover) => {
    expect(parse({ room: 'abcd', name: 'Bob', takeover })).toBeNull();
  });

  it('requires a name for takeover', () => {
    expect(parse({ room: 'abcd', takeover: '1' })).toBeNull();
  });

  it('accepts a reconnect token without a name and ignores other params', () => {
    const token = 'Ab9_-'.repeat(6) + 'xy';
    expect(parse({ room: 'abcd', token })).toEqual({ room: 'abcd', token });
    expect(parse({ room: 'abcd', token, name: 'Bob', spectating: '1' })).toEqual({ room: 'abcd', token });
  });

  it.each(['', 'short', 'x'.repeat(33), `${'x'.repeat(31)}!`])('rejects token %j', (token) => {
    expect(parse({ room: 'abcd', name: 'Bob', token })).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it.each([
    ['not json', 'Malformed message'],
    ['null', 'Unknown message type'],
    ['[]', 'Unknown message type'],
    ['{}', 'Unknown message type'],
    ['{"type":"dance"}', 'Unknown message type'],
    ['{"type":"vote","round":0}', 'Invalid vote message'],
    ['{"type":"vote","value":5,"round":0}', 'Invalid vote message'],
    ['{"type":"vote","value":"   ","round":0}', 'Invalid vote message'],
    [JSON.stringify({ type: 'vote', value: 'x'.repeat(65), round: 0 }), 'Invalid vote message'],
    ['{"type":"vote","value":"5"}', 'Invalid vote message'],
    ['{"type":"vote","value":"5","round":"0"}', 'Invalid vote message'],
    ['{"type":"vote","value":"5","round":-1}', 'Invalid vote message'],
    ['{"type":"vote","value":"5","round":1.5}', 'Invalid vote message'],
  ])('rejects %s with %s', (raw, error) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error });
  });

  it('keeps vote value verbatim', () => {
    expect(parseClientMessage('{"type":"vote","value":" 5 ","round":3}')).toEqual({
      ok: true,
      message: { type: 'vote', value: ' 5 ', round: 3 },
    });
  });

  it.each(['reveal', 'reset'])('accepts %s', (type) => {
    expect(parseClientMessage(JSON.stringify({ type }))).toEqual({ ok: true, message: { type } });
  });

  const addTicket = (ticket: unknown) => JSON.stringify({ type: 'addTicket', ticket });

  it.each([
    ['missing ticket', '{"type":"addTicket"}'],
    ['null ticket', addTicket(null)],
    ['array ticket', addTicket([])],
    ['epic type', addTicket({ type: 'epic', title: 'Login', description: '' })],
    ['missing type', addTicket({ title: 'Login', description: '' })],
    ['missing title', addTicket({ type: 'story', description: '' })],
    ['numeric title', addTicket({ type: 'story', title: 5, description: '' })],
    ['blank title', addTicket({ type: 'story', title: ' \t ', description: '' })],
    ['title with a line break', addTicket({ type: 'story', title: 'Login\npage', description: '' })],
    ['101-char title', addTicket({ type: 'story', title: 'x'.repeat(101), description: '' })],
    ['missing description', addTicket({ type: 'story', title: 'Login' })],
    ['null description', addTicket({ type: 'story', title: 'Login', description: null })],
    ['501-char description', addTicket({ type: 'story', title: 'Login', description: 'x'.repeat(501) })],
    ['legacy content only', addTicket({ type: 'story', content: 'Login' })],
  ])('rejects addTicket with %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: 'Invalid addTicket message' });
  });

  it('accepts addTicket, trimming both fields and counting emoji as one char', () => {
    expect(
      parseClientMessage(addTicket({ type: 'story', title: '  Login page  ', description: '  As a user\nI log in  ' })),
    ).toEqual({
      ok: true,
      message: { type: 'addTicket', ticket: { type: 'story', title: 'Login page', description: 'As a user\nI log in' } },
    });
    const ticket = { type: 'story', title: '🐧'.repeat(100), description: '🐧'.repeat(500) };
    expect(parseClientMessage(addTicket(ticket))).toMatchObject({ ok: true });
  });

  it('accepts a 1-char title with an empty description, trimming a blank one to empty', () => {
    expect(parseClientMessage(addTicket({ type: 'spike', title: 'X', description: '   ' }))).toEqual({
      ok: true,
      message: { type: 'addTicket', ticket: { type: 'spike', title: 'X', description: '' } },
    });
  });

  const edit = { ticketId: 'ticket-1', title: 'Login', description: '' };

  it.each([
    ['missing ticketId', { ...edit, ticketId: undefined }],
    ['numeric ticketId', { ...edit, ticketId: 1 }],
    ['empty ticketId', { ...edit, ticketId: '' }],
    ['ticketId over 64 chars', { ...edit, ticketId: 't'.repeat(65) }],
    ['missing title', { ...edit, title: undefined }],
    ['blank title', { ...edit, title: '   ' }],
    ['title with a line break', { ...edit, title: 'A\r\nB' }],
    ['101-char title', { ...edit, title: 'x'.repeat(101) }],
    ['missing description', { ...edit, description: undefined }],
    ['501-char description', { ...edit, description: 'x'.repeat(501) }],
    ['legacy content only', { ticketId: 'ticket-1', content: 'Login' }],
    ['unknown ticketType', { ...edit, ticketType: 'epic' }],
    ['null ticketType', { ...edit, ticketType: null }],
  ])('rejects editTicket with %s', (_label, fields) => {
    expect(parseClientMessage(JSON.stringify({ type: 'editTicket', ...fields }))).toEqual({
      ok: false,
      error: 'Invalid editTicket message',
    });
  });

  it('accepts editTicket, trimming both fields', () => {
    const raw = JSON.stringify({ type: 'editTicket', ticketId: 'ticket-1', title: ' SSO ', description: ' Use Okta ' });
    expect(parseClientMessage(raw)).toEqual({
      ok: true,
      message: { type: 'editTicket', ticketId: 'ticket-1', title: 'SSO', description: 'Use Okta' },
    });
  });

  it.each(['story', 'spike'])('accepts editTicket with ticketType %s', (ticketType) => {
    const raw = JSON.stringify({ type: 'editTicket', ...edit, ticketType });
    expect(parseClientMessage(raw)).toEqual({
      ok: true,
      message: { type: 'editTicket', ...edit, ticketType },
    });
  });

  it.each(['removeTicket', 'selectTicket'])('validates the ticketId of %s', (type) => {
    expect(parseClientMessage(JSON.stringify({ type, ticketId: 'ticket-1' }))).toEqual({
      ok: true,
      message: { type, ticketId: 'ticket-1' },
    });
    for (const ticketId of [undefined, 7, '', 't'.repeat(65)]) {
      expect(parseClientMessage(JSON.stringify({ type, ticketId }))).toEqual({
        ok: false,
        error: `Invalid ${type} message`,
      });
    }
  });

  it.each([true, false])('accepts setSpectating %s', (spectating) => {
    expect(parseClientMessage(JSON.stringify({ type: 'setSpectating', spectating }))).toEqual({
      ok: true,
      message: { type: 'setSpectating', spectating },
    });
  });

  it.each([undefined, 'true', 1, null])('rejects setSpectating with %j', (spectating) => {
    expect(parseClientMessage(JSON.stringify({ type: 'setSpectating', spectating }))).toEqual({
      ok: false,
      error: 'Invalid setSpectating message',
    });
  });

  it('no longer accepts setTicket', () => {
    const raw = JSON.stringify({ type: 'setTicket', ticket: { type: 'story', title: 'Login', description: '' } });
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: 'Unknown message type' });
  });
});

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toMatchObject({
      port: 3000,
      maxRoomUsers: 50,
      roomCloseGraceMs: 60_000,
      allowedOrigins: ['http://localhost:5173'],
    });
  });

  it('parses overrides', () => {
    const config = loadConfig({
      MAX_ROOM_USERS: '30',
      ROOM_CLOSE_GRACE_MS: '5000',
      ALLOWED_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(config.maxRoomUsers).toBe(30);
    expect(config.roomCloseGraceMs).toBe(5_000);
    expect(config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects invalid numbers', () => {
    expect(() => loadConfig({ MAX_ROOM_USERS: 'lots' })).toThrow('Invalid MAX_ROOM_USERS');
  });
});
