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
    ['{"type":"vote"}', 'Invalid vote message'],
    ['{"type":"vote","value":5}', 'Invalid vote message'],
    ['{"type":"vote","value":"   "}', 'Invalid vote message'],
    [JSON.stringify({ type: 'vote', value: 'x'.repeat(65) }), 'Invalid vote message'],
  ])('rejects %s with %s', (raw, error) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error });
  });

  it('keeps vote value verbatim', () => {
    expect(parseClientMessage('{"type":"vote","value":" 5 "}')).toEqual({
      ok: true,
      message: { type: 'vote', value: ' 5 ' },
    });
  });

  it.each(['reveal', 'reset'])('accepts %s', (type) => {
    expect(parseClientMessage(JSON.stringify({ type }))).toEqual({ ok: true, message: { type } });
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
