const ROOM_ID_PATTERN = /^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$/;
export const MAX_ROOM_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 32;
export const MAX_DECK_LENGTH = 32;
export const MAX_AVATAR_LENGTH = 32;
export const MAX_VOTE_LENGTH = 64;
export const MAX_TICKET_TITLE_LENGTH = 100;
export const MAX_TICKET_DESCRIPTION_LENGTH = 500;
export const MAX_TICKETS = 10;
export const STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13, 20] as const;
export const MAX_JIRA_TITLE_LENGTH = 255;
export const MAX_JIRA_EDIT_TEXT_LENGTH = 50_000;
export const MAX_JIRA_EXTRA_FIELDS = 10;
export const MAX_JIRA_EDIT_MESSAGE_BYTES = MAX_JIRA_EDIT_TEXT_LENGTH * (MAX_JIRA_EXTRA_FIELDS + 1) * 6 + 16 * 1024;
const MAX_TICKET_ID_LENGTH = 64;

const charLength = (value: string): number => Array.from(value).length;

export function isValidRoomId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_ROOM_ID_LENGTH && ROOM_ID_PATTERN.test(value);
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export type ConnectParams =
  | { room: string; token: string }
  | {
      room: string;
      token?: undefined;
      name: string;
      deck?: string;
      avatar?: string;
      spectating?: boolean;
      takeover?: boolean;
    };

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

  const takeover = params.get('takeover');
  if (takeover !== null && takeover !== '1') return null;

  return {
    room,
    name,
    deck: deck.value,
    avatar: avatar.value,
    ...(spectating ? { spectating: true } : {}),
    ...(takeover ? { takeover: true } : {}),
  };
}

export type TicketType = 'story' | 'spike' | 'bug' | 'task';

export interface Ticket {
  type: TicketType;
  title: string;
  description: string;
}

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: AdfNode[];
}

export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export interface JiraLink {
  cloudId: string;
  issueId: string;
  key: string;
  url: string;
}

export type JiraClientMessage =
  | { type: 'jira'; requestId: string; action: 'status' | 'disconnect' }
  | { type: 'jira'; requestId: string; action: 'connect'; returnUrl?: string }
  | { type: 'jira'; requestId: string; action: 'suggest'; query: string }
  | { type: 'jira'; requestId: string; action: 'selectSite'; siteId: string }
  | { type: 'jira'; requestId: string; action: 'import'; input: string }
  | { type: 'jira'; requestId: string; action: 'agree'; ticketId: string; points: number }
  | { type: 'jira'; requestId: string; action: 'prepare'; ticketId: string; fieldId?: string }
  | { type: 'jira'; requestId: string; action: 'confirm'; confirmationId: string }
  | { type: 'jira'; requestId: string; action: 'details'; ticketId: string }
  | { type: 'jira'; requestId: string; action: 'prepareEdit'; ticketId: string; title: string; description: string; extraFields?: Record<string, string> }
  | { type: 'jira'; requestId: string; action: 'confirmEdit'; confirmationId: string };

export const isTicketType = (value: unknown): value is TicketType =>
  value === 'story' || value === 'spike' || value === 'bug' || value === 'task';

export type ClientMessage =
  | JiraClientMessage
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

function parseJiraTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const length = charLength(trimmed);
  return length >= 1 && length <= MAX_JIRA_TITLE_LENGTH && !/[\r\n\u2028\u2029]/.test(trimmed) ? trimmed : null;
}

function parseJiraText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return charLength(trimmed) <= MAX_JIRA_EDIT_TEXT_LENGTH ? trimmed : null;
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
    case 'jira': {
      const { requestId, action } = message;
      const invalid = { ok: false, error: 'Invalid Jira request' } as const;
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) return invalid;
      const base = { type: 'jira', requestId } as const;
      const bounded = (value: unknown, length: number): value is string =>
        typeof value === 'string' && value.trim().length > 0 && value.length <= length;
      if (action === 'status' || action === 'disconnect') {
        return { ok: true, message: { ...base, action } };
      }
      if (action === 'connect' && (message.returnUrl === undefined || bounded(message.returnUrl, 2_048))) {
        return { ok: true, message: { ...base, action,
          ...(message.returnUrl === undefined ? {} : { returnUrl: message.returnUrl as string }) } };
      }
      if (action === 'suggest' && typeof message.query === 'string' && message.query.length <= 64 &&
          /^[A-Z][A-Z0-9_]*-\d*$/i.test(message.query)) {
        return { ok: true, message: { ...base, action, query: message.query.toUpperCase() } };
      }
      if (action === 'selectSite' && bounded(message.siteId, 128)) {
        return { ok: true, message: { ...base, action, siteId: message.siteId } };
      }
      if (action === 'import' && bounded(message.input, 512)) {
        return { ok: true, message: { ...base, action, input: message.input } };
      }
      if (action === 'confirm' && bounded(message.confirmationId, 64)) {
        return { ok: true, message: { ...base, action, confirmationId: message.confirmationId } };
      }
      if (action === 'agree' && isTicketId(message.ticketId) &&
          typeof message.points === 'number' && (STORY_POINT_VALUES as readonly number[]).includes(message.points)) {
        return { ok: true, message: { ...base, action, ticketId: message.ticketId, points: message.points } };
      }
      if (action === 'prepare' && isTicketId(message.ticketId) &&
          (message.fieldId === undefined || bounded(message.fieldId, 128))) {
        return { ok: true, message: { ...base, action, ticketId: message.ticketId, fieldId: message.fieldId as string | undefined } };
      }
      if (action === 'details' && isTicketId(message.ticketId)) {
        return { ok: true, message: { ...base, action, ticketId: message.ticketId } };
      }
      if (action === 'confirmEdit' && bounded(message.confirmationId, 64)) {
        return { ok: true, message: { ...base, action, confirmationId: message.confirmationId } };
      }
      if (action === 'prepareEdit' && isTicketId(message.ticketId)) {
        const title = parseJiraTitle(message.title);
        const description = parseJiraText(message.description);
        if (title === null || description === null) return invalid;
        if (message.extraFields === undefined) {
          return { ok: true, message: { ...base, action, ticketId: message.ticketId, title, description } };
        }
        if (typeof message.extraFields !== 'object' || message.extraFields === null || Array.isArray(message.extraFields)) return invalid;
        const entries = Object.entries(message.extraFields as Record<string, unknown>);
        if (entries.length > MAX_JIRA_EXTRA_FIELDS) return invalid;
        const extraFields: Record<string, string> = {};
        for (const [id, value] of entries) {
          if (!/^[A-Za-z0-9_]{1,64}$/.test(id)) return invalid;
          const parsed = parseJiraText(value);
          if (parsed === null) return invalid;
          extraFields[id] = parsed;
        }
        return { ok: true, message: { ...base, action, ticketId: message.ticketId, title, description, extraFields } };
      }
      return invalid;
    }
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
