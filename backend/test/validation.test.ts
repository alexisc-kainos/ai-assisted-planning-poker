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
    expect(parse({ room: 'abcd', name: 'x'.repeat(32) })?.name).toHaveLength(32);
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
    ['epic type', addTicket({ type: 'epic', content: 'Login' })],
    ['missing type', addTicket({ content: 'Login' })],
    ['numeric content', addTicket({ type: 'story', content: 5 })],
    ['blank content', addTicket({ type: 'story', content: ' \n ' })],
    ['501 chars', addTicket({ type: 'story', content: 'x'.repeat(501) })],
  ])('rejects addTicket with %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: 'Invalid addTicket message' });
  });

  it('accepts addTicket, trimming content and counting emoji as one char', () => {
    expect(parseClientMessage(addTicket({ type: 'story', content: '  Login\npage  ' }))).toEqual({
      ok: true,
      message: { type: 'addTicket', ticket: { type: 'story', content: 'Login\npage' } },
    });
    const emoji = '🐧'.repeat(500);
    expect(parseClientMessage(addTicket({ type: 'story', content: emoji }))).toMatchObject({ ok: true });
  });

  it('accepts a spike addTicket', () => {
    expect(parseClientMessage(addTicket({ type: 'spike', content: 'Investigate' }))).toEqual({
      ok: true,
      message: { type: 'addTicket', ticket: { type: 'spike', content: 'Investigate' } },
    });
  });

  it.each([
    ['missing ticketId', { content: 'Login' }],
    ['numeric ticketId', { ticketId: 1, content: 'Login' }],
    ['empty ticketId', { ticketId: '', content: 'Login' }],
    ['ticketId over 64 chars', { ticketId: 't'.repeat(65), content: 'Login' }],
    ['missing content', { ticketId: 'ticket-1' }],
    ['blank content', { ticketId: 'ticket-1', content: '   ' }],
    ['501 chars', { ticketId: 'ticket-1', content: 'x'.repeat(501) }],
    ['unknown ticketType', { ticketId: 'ticket-1', content: 'Login', ticketType: 'epic' }],
    ['null ticketType', { ticketId: 'ticket-1', content: 'Login', ticketType: null }],
  ])('rejects editTicket with %s', (_label, fields) => {
    expect(parseClientMessage(JSON.stringify({ type: 'editTicket', ...fields }))).toEqual({
      ok: false,
      error: 'Invalid editTicket message',
    });
  });

  it('accepts editTicket, trimming content', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'editTicket', ticketId: 'ticket-1', content: ' SSO ' }))).toEqual({
      ok: true,
      message: { type: 'editTicket', ticketId: 'ticket-1', content: 'SSO' },
    });
  });

  it.each(['story', 'spike'])('accepts editTicket with ticketType %s', (ticketType) => {
    const raw = JSON.stringify({ type: 'editTicket', ticketId: 'ticket-1', content: 'SSO', ticketType });
    expect(parseClientMessage(raw)).toEqual({
      ok: true,
      message: { type: 'editTicket', ticketId: 'ticket-1', content: 'SSO', ticketType },
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

  it('no longer accepts setTicket', () => {
    const raw = JSON.stringify({ type: 'setTicket', ticket: { type: 'story', content: 'Login' } });
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: 'Unknown message type' });
  });
});

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toMatchObject({ port: 3000, maxRoomUsers: 50, allowedOrigins: ['http://localhost:5173'] });
  });

  it('parses overrides', () => {
    const config = loadConfig({ MAX_ROOM_USERS: '30', ALLOWED_ORIGINS: 'https://a.example, https://b.example' });
    expect(config.maxRoomUsers).toBe(30);
    expect(config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects invalid numbers', () => {
    expect(() => loadConfig({ MAX_ROOM_USERS: 'lots' })).toThrow('Invalid MAX_ROOM_USERS');
  });
});
