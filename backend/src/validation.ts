const ROOM_ID_PATTERN = /^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$/;
export const MAX_ROOM_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 32;
export const MAX_DECK_LENGTH = 32;
export const MAX_AVATAR_LENGTH = 32;
export const MAX_VOTE_LENGTH = 64;
export const MAX_TICKET_LENGTH = 500;

const charLength = (value: string): number => Array.from(value).length;

export function isValidRoomId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_ROOM_ID_LENGTH && ROOM_ID_PATTERN.test(value);
}

export interface ConnectParams {
  room: string;
  name: string;
  deck?: string;
  avatar?: string;
}

type OptionalResult = { ok: true; value?: string } | { ok: false };

function parseOptional(raw: string | null, max: number): OptionalResult {
  const value = raw?.trim();
  if (!value) return { ok: true };
  return charLength(value) <= max ? { ok: true, value } : { ok: false };
}

export function parseConnectParams(params: URLSearchParams): ConnectParams | null {
  const room = params.get('room');
  if (!isValidRoomId(room)) return null;

  const name = params.get('name')?.trim();
  if (!name || charLength(name) > MAX_NAME_LENGTH) return null;

  const deck = parseOptional(params.get('deck'), MAX_DECK_LENGTH);
  const avatar = parseOptional(params.get('avatar'), MAX_AVATAR_LENGTH);
  if (!deck.ok || !avatar.ok) return null;

  return { room, name, deck: deck.value, avatar: avatar.value };
}

export interface Ticket {
  type: 'story';
  content: string;
}

export type ClientMessage =
  | { type: 'vote'; value: string }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'setTicket'; ticket: Ticket };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Malformed message' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'Unknown message type' };
  }
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case 'vote': {
      const { value } = message;
      if (typeof value !== 'string') return { ok: false, error: 'Invalid vote message' };
      const length = charLength(value.trim());
      if (length < 1 || length > MAX_VOTE_LENGTH) return { ok: false, error: 'Invalid vote message' };
      return { ok: true, message: { type: 'vote', value } };
    }
    case 'reveal':
      return { ok: true, message: { type: 'reveal' } };
    case 'reset':
      return { ok: true, message: { type: 'reset' } };
    case 'setTicket': {
      const invalid = { ok: false, error: 'Invalid setTicket message' } as const;
      const { ticket } = message;
      if (typeof ticket !== 'object' || ticket === null || Array.isArray(ticket)) return invalid;
      const { type, content } = ticket as Record<string, unknown>;
      if (type !== 'story' || typeof content !== 'string') return invalid;
      const trimmed = content.trim();
      const length = charLength(trimmed);
      if (length < 1 || length > MAX_TICKET_LENGTH) return invalid;
      return { ok: true, message: { type: 'setTicket', ticket: { type, content: trimmed } } };
    }
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}
