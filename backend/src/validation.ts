const ROOM_ID_PATTERN = /^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$/;
export const MAX_ROOM_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 32;
export const MAX_DECK_LENGTH = 32;
export const MAX_AVATAR_LENGTH = 32;
export const MAX_VOTE_LENGTH = 64;
export const MAX_TICKET_LENGTH = 500;
export const MAX_TICKETS = 10;
const MAX_TICKET_ID_LENGTH = 64;

const charLength = (value: string): number => Array.from(value).length;

export function isValidRoomId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_ROOM_ID_LENGTH && ROOM_ID_PATTERN.test(value);
}

export interface ConnectParams {
  room: string;
  name: string;
  deck?: string;
  avatar?: string;
  spectating?: boolean;
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

  const spectating = params.get('spectating');
  if (spectating !== null && spectating !== '1') return null;

  return { room, name, deck: deck.value, avatar: avatar.value, ...(spectating ? { spectating: true } : {}) };
}

export type TicketType = 'story' | 'spike';

export interface Ticket {
  type: TicketType;
  content: string;
}

const isTicketType = (value: unknown): value is TicketType => value === 'story' || value === 'spike';

export type ClientMessage =
  | { type: 'vote'; value: string; round: number }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'addTicket'; ticket: Ticket }
  | { type: 'editTicket'; ticketId: string; content: string; ticketType?: TicketType }
  | { type: 'removeTicket'; ticketId: string }
  | { type: 'selectTicket'; ticketId: string }
  | { type: 'setSpectating'; spectating: boolean };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

function parseContent(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  const length = charLength(trimmed);
  return length >= 1 && length <= MAX_TICKET_LENGTH ? trimmed : null;
}

function isTicketId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_TICKET_ID_LENGTH;
}

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
      const { value, round } = message;
      if (typeof value !== 'string') return { ok: false, error: 'Invalid vote message' };
      if (!Number.isSafeInteger(round) || (round as number) < 0) return { ok: false, error: 'Invalid vote message' };
      const length = charLength(value.trim());
      if (length < 1 || length > MAX_VOTE_LENGTH) return { ok: false, error: 'Invalid vote message' };
      return { ok: true, message: { type: 'vote', value, round: round as number } };
    }
    case 'reveal':
      return { ok: true, message: { type: 'reveal' } };
    case 'reset':
      return { ok: true, message: { type: 'reset' } };
    case 'addTicket': {
      const invalid = { ok: false, error: 'Invalid addTicket message' } as const;
      const { ticket } = message;
      if (typeof ticket !== 'object' || ticket === null || Array.isArray(ticket)) return invalid;
      const { type, content } = ticket as Record<string, unknown>;
      const trimmed = parseContent(content);
      if (!isTicketType(type) || trimmed === null) return invalid;
      return { ok: true, message: { type: 'addTicket', ticket: { type, content: trimmed } } };
    }
    case 'editTicket': {
      const { ticketId, ticketType } = message;
      const content = parseContent(message.content);
      if (!isTicketId(ticketId) || content === null) return { ok: false, error: 'Invalid editTicket message' };
      if (ticketType === undefined) return { ok: true, message: { type: 'editTicket', ticketId, content } };
      if (!isTicketType(ticketType)) return { ok: false, error: 'Invalid editTicket message' };
      return { ok: true, message: { type: 'editTicket', ticketId, content, ticketType } };
    }
    case 'removeTicket':
    case 'selectTicket': {
      const { type, ticketId } = message;
      if (!isTicketId(ticketId)) return { ok: false, error: `Invalid ${type} message` };
      return { ok: true, message: { type, ticketId } };
    }
    case 'setSpectating': {
      const { spectating } = message;
      if (typeof spectating !== 'boolean') return { ok: false, error: 'Invalid setSpectating message' };
      return { ok: true, message: { type: 'setSpectating', spectating } };
    }
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}
