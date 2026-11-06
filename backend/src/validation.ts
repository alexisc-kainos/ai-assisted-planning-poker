const ROOM_ID_PATTERN = /^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$/;
export const MAX_ROOM_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 32;
export const MAX_DECK_LENGTH = 32;
export const MAX_AVATAR_LENGTH = 32;
export const MAX_VOTE_LENGTH = 64;
export const MAX_TICKET_TITLE_LENGTH = 100;
export const MAX_TICKET_DESCRIPTION_LENGTH = 500;
export const MAX_TICKETS = 10;
const MAX_TICKET_ID_LENGTH = 64;

const charLength = (value: string): number => Array.from(value).length;

export function isValidRoomId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_ROOM_ID_LENGTH && ROOM_ID_PATTERN.test(value);
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export type ConnectParams =
  | { room: string; token: string }
  | { room: string; token?: undefined; name: string; deck?: string; avatar?: string; spectating?: boolean };

type OptionalResult = { ok: true; value?: string } | { ok: false };

function parseOptional(raw: string | null, max: number): OptionalResult {
  const value = raw?.trim();
  if (!value) return { ok: true };
  return charLength(value) <= max ? { ok: true, value } : { ok: false };
}

export function parseConnectParams(params: URLSearchParams): ConnectParams | null {
  const room = params.get('room');
  if (!isValidRoomId(room)) return null;

  const token = params.get('token');
  if (token !== null) return TOKEN_PATTERN.test(token) ? { room, token } : null;

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
  title: string;
  description: string;
}

const isTicketType = (value: unknown): value is TicketType => value === 'story' || value === 'spike';

export type ClientMessage =
  | { type: 'vote'; value: string; round: number }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'addTicket'; ticket: Ticket }
  | { type: 'editTicket'; ticketId: string; title: string; description: string; ticketType?: TicketType }
  | { type: 'removeTicket'; ticketId: string }
  | { type: 'selectTicket'; ticketId: string }
  | { type: 'setSpectating'; spectating: boolean };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

function parseTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  const length = charLength(trimmed);
  return length >= 1 && length <= MAX_TICKET_TITLE_LENGTH && !/[\r\n\u2028\u2029]/.test(trimmed) ? trimmed : null;
}

function parseDescription(description: unknown): string | null {
  if (typeof description !== 'string') return null;
  const trimmed = description.trim();
  return charLength(trimmed) <= MAX_TICKET_DESCRIPTION_LENGTH ? trimmed : null;
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
      const fields = ticket as Record<string, unknown>;
      const { type } = fields;
      const title = parseTitle(fields.title);
      const description = parseDescription(fields.description);
      if (!isTicketType(type) || title === null || description === null) return invalid;
      return { ok: true, message: { type: 'addTicket', ticket: { type, title, description } } };
    }
    case 'editTicket': {
      const invalid = { ok: false, error: 'Invalid editTicket message' } as const;
      const { ticketId, ticketType } = message;
      const title = parseTitle(message.title);
      const description = parseDescription(message.description);
      if (!isTicketId(ticketId) || title === null || description === null) return invalid;
      if (ticketType === undefined) return { ok: true, message: { type: 'editTicket', ticketId, title, description } };
      if (!isTicketType(ticketType)) return invalid;
      return { ok: true, message: { type: 'editTicket', ticketId, title, description, ticketType } };
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
