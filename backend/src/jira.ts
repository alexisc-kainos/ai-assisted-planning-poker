import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JiraConfig } from './config.js';
import type { Room, RoomTicket } from './rooms.js';
import { isTicketType, STORY_POINT_VALUES, type AdfDocument, type AdfNode, type JiraClientMessage } from './validation.js';

export interface JiraSite { id: string; name: string; url: string }
export interface JiraStatus {
  available: boolean;
  connected: boolean;
  site?: JiraSite;
  sites?: JiraSite[];
  reason?: string;
}
export interface JiraField { id: string; name: string }
export interface JiraSuggestion { key: string; summary: string }
export interface JiraPreview {
  id: string;
  issueKey: string;
  issueUrl: string;
  siteName: string;
  fieldId: string;
  fieldName: string;
  currentPoints: number | null;
  points: number;
}
export interface JiraEditChange { fieldId: string; fieldName: string; from: string; to: string }
export interface JiraEditPreview {
  id: string;
  issueKey: string;
  issueUrl: string;
  siteName: string;
  changes: JiraEditChange[];
}
export interface JiraExtraField { id: string; name: string; adf: AdfDocument }
export interface JiraTicketDetail {
  title: string;
  descriptionAdf: AdfDocument;
  extraFields?: JiraExtraField[];
}
export interface JiraResult {
  status?: JiraStatus;
  authorizeUrl?: string;
  ticketId?: string;
  fields?: JiraField[];
  preview?: JiraPreview;
  written?: boolean;
  uncertain?: boolean;
  suggestions?: JiraSuggestion[];
  detail?: JiraTicketDetail;
  editPreview?: JiraEditPreview;
}
interface Confirmation {
  preview: JiraPreview;
  ticket: RoomTicket;
  revision: number;
  round: number;
  expiresAt: number;
}
interface EditField extends JiraField { kind: 'string' | 'adf' }
interface EditConfirmation {
  preview: JiraEditPreview;
  ticket: RoomTicket;
  revision: number;
  expiresAt: number;
  values: { title: string; description: string; extraFields: Record<string, string> };
  fields: EditField[];
}
interface Session {
  ownerId: string;
  ownerToken: string;
  accessToken?: string;
  expiresAt: number;
  sites: JiraSite[];
  site?: JiraSite;
  timer?: NodeJS.Timeout;
  busy: boolean;
  confirmation?: Confirmation;
  editConfirmation?: EditConfirmation;
  suggestionRequest?: AbortController;
  returnUrl?: string;
}
interface PendingOAuth {
  room: Room;
  session: Session;
  expiresAt: number;
  state?: string;
}

const randomId = () => randomBytes(24).toString('base64url');
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const MAX_ADF_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const OAUTH_LIFETIME = 10 * 60 * 1_000;

export function parseJiraIssueKey(input: string, siteOrigin: string): string {
  const trimmed = input.trim();
  const pattern = /^[A-Z][A-Z0-9_]*-\d+$/i;
  if (trimmed.length <= 512 && pattern.test(trimmed)) return trimmed.toUpperCase();
  try {
    const url = new URL(trimmed);
    const match = /^\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/i.exec(url.pathname);
    if (trimmed.length <= 512 && url.protocol === 'https:' && url.origin === siteOrigin &&
        !url.username && !url.password && match) return match[1].toUpperCase();
  } catch {
    throw new Error('Provide an issue key or Jira issue URL from the connected site');
  }
  throw new Error('Provide an issue key or Jira issue URL from the connected site');
}

export function validateJiraDescription(value: unknown): AdfDocument {
  if (value === null || value === undefined) return { type: 'doc', version: 1, content: [] };
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_ADF_BYTES) throw new Error('Jira description exceeds the 256 KiB safety limit; nothing was imported');
  let count = 0;
  const node = (candidate: unknown, depth: number): candidate is AdfNode => {
    if (++count > 20_000 || depth > 64 || !record(candidate) || typeof candidate.type !== 'string') return false;
    if (candidate.text !== undefined && typeof candidate.text !== 'string') return false;
    if (candidate.attrs !== undefined && !record(candidate.attrs)) return false;
    if (candidate.marks !== undefined && (!Array.isArray(candidate.marks) || !candidate.marks.every((mark) =>
      record(mark) && typeof mark.type === 'string' && (mark.attrs === undefined || record(mark.attrs))))) return false;
    return candidate.content === undefined || (Array.isArray(candidate.content) &&
      candidate.content.every((child) => node(child, depth + 1)));
  };
  if (!node(value, 0) || !record(value) || value.type !== 'doc' || value.version !== 1 || !Array.isArray(value.content)) {
    throw new Error('Jira description is invalid or exceeds the nesting safety limit; nothing was imported');
  }
  return value as unknown as AdfDocument;
}

function numericValue(issue: unknown, fieldId: string): number | null {
  if (!record(issue) || !record(issue.fields) || !(fieldId in issue.fields)) throw new Error('Jira did not return the story-points field');
  const value = issue.fields[fieldId];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Jira story-points field is not numeric');
  return value;
}

/** Flattens an ADF document to plain text; paragraphs/headings/list items become lines, separated by a blank line. */
function adfToPlainText(doc: AdfDocument): string {
  const blocks: string[] = [];
  const textOf = (node: AdfNode): string => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return typeof node.attrs?.text === 'string' ? node.attrs.text : 'Mention in Jira';
    if (node.type === 'emoji') return typeof node.attrs?.text === 'string' ? node.attrs.text
      : typeof node.attrs?.shortName === 'string' ? node.attrs.shortName : '';
    return (node.content ?? []).map(textOf).join('');
  };
  const walk = (node: AdfNode): void => {
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(node.type)) {
      const text = (node.content ?? []).map(textOf).join('');
      if (text) blocks.push(text);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc as unknown as AdfNode);
  return blocks.join('\n\n');
}

/** Converts plain text back to a simple ADF document; blank lines separate paragraphs. */
function plainTextToAdf(text: string): AdfDocument {
  const paragraphs = text.split(/\r?\n(?:\r?\n)+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return {
    type: 'doc', version: 1,
    content: paragraphs.map((paragraph) => ({ type: 'paragraph', content: paragraph.split(/\r?\n/).flatMap((line, index) => [
      ...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : []),
    ]) })),
  };
}

interface TextFieldValue { text: string; adf: AdfDocument; kind: 'string' | 'adf' }

/** Reads a text-ish custom field that Jira may return as a plain string or an ADF document. */
function textFieldValue(issue: unknown, fieldId: string): TextFieldValue | null {
  if (!record(issue) || !record(issue.fields)) throw new Error('Jira returned an invalid issue');
  // Jira omits fields that aren't on this issue's field configuration rather than returning null; treat that as no value.
  if (!(fieldId in issue.fields)) return null;
  const value = issue.fields[fieldId];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { text: trimmed, adf: validateJiraDescription(plainTextToAdf(trimmed)), kind: 'string' } : null;
  }
  if (!record(value) || value.type !== 'doc') return null;
  const adf = validateJiraDescription(value);
  const text = adfToPlainText(adf).trim();
  return text ? { text, adf, kind: 'adf' } : null;
}

function htmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export class JiraService {
  private readonly sessions = new Map<Room, Session>();
  private readonly starts = new Map<string, PendingOAuth>();
  private readonly states = new Map<string, PendingOAuth>();

  constructor(
    private readonly config: JiraConfig | undefined,
    private readonly changed: (room: Room, status: JiraStatus) => void,
    private readonly request: typeof fetch = fetch,
    private readonly frontendOrigins: readonly string[] = [],
  ) {}

  status(room: Room): JiraStatus {
    this.reconcile(room);
    const session = this.sessions.get(room);
    return {
      available: !!this.config,
      connected: !!session?.accessToken && !!session.site,
      ...(session?.site ? { site: session.site } : {}),
      ...(session?.accessToken && !session.site ? { sites: session.sites } : {}),
    };
  }

  reconcile(room: Room): void {
    const session = this.sessions.get(room);
    if (!session) return;
    const member = room.findByToken(session.ownerToken);
    if (!member || !member.connected || member.id !== room.hostId || member.id !== session.ownerId) {
      this.clear(room, 'Facilitator changed. Connect your own Jira account.');
    } else if (session.expiresAt <= Date.now()) {
      this.clear(room, 'Jira authorisation expired. Reauthorise to continue.');
    }
  }

  clear(room: Room, reason?: string): void {
    const session = this.sessions.get(room);
    clearTimeout(session?.timer);
    if (session) {
      session.suggestionRequest?.abort();
      delete session.accessToken;
      delete session.confirmation;
      delete session.editConfirmation;
    }
    this.sessions.delete(room);
    for (const [key, pending] of this.starts) if (pending.room === room) this.starts.delete(key);
    for (const [key, pending] of this.states) if (pending.room === room) this.states.delete(key);
    this.changed(room, { available: !!this.config, connected: false, ...(reason ? { reason } : {}) });
  }

  shutdown(): void {
    for (const room of this.sessions.keys()) this.clear(room);
    this.starts.clear();
    this.states.clear();
  }

  private valid(room: Room, session: Session): void {
    this.reconcile(room);
    if (this.sessions.get(room) !== session) throw new Error('Jira connection changed or expired. Reauthorise to continue.');
  }

  private armExpiry(room: Room, session: Session): void {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => this.reconcile(room), Math.max(1, session.expiresAt - Date.now()));
    session.timer.unref();
  }

  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const timeout = AbortSignal.timeout(15_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await this.request(url, { ...init, signal, redirect: 'error' });
    if (!response.ok) {
      if (response.status === 401) throw new Error('jira_unauthorised');
      if (response.status === 403) throw new Error('Your Jira account is not permitted to perform this action');
      if (response.status === 404) throw new Error('Jira issue or field was not found or is not visible to your account');
      if (response.status === 429) throw new Error('Jira is rate limiting requests. Wait before trying again.');
      throw new Error('Jira request failed. Please try again later.');
    }
    if (response.status === 204) return null;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Jira returned an empty response');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw new Error('Jira response exceeds the safety limit');
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  private async api(room: Room, session: Session, path: string, init?: RequestInit): Promise<unknown> {
    this.valid(room, session);
    if (!session.accessToken || !session.site) throw new Error('Connect and select a Jira site first');
    try {
      const result = await this.json(`https://api.atlassian.com/ex/jira/${encodeURIComponent(session.site.id)}${path}`, {
        ...init,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers, Authorization: `Bearer ${session.accessToken}` },
      });
      this.valid(room, session);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'jira_unauthorised') {
        if (this.sessions.get(room) === session) this.clear(room, 'Jira authorisation expired. Reauthorise to continue.');
        throw new Error('Jira authorisation expired. Reauthorise to continue.');
      }
      if (error instanceof Error && (error.name === 'TypeError' || error.name === 'TimeoutError' || error.name === 'AbortError' || error.name === 'SyntaxError')) {
        throw new Error('Jira could not be reached or returned an invalid response');
      }
      throw error;
    }
  }

  async action(room: Room, userId: string, message: JiraClientMessage, origin?: string): Promise<JiraResult> {
    if (room.hostId !== userId) throw new Error('Only the facilitator can use Jira');
    if (message.action === 'status') return { status: this.status(room) };
    if (message.action === 'disconnect') {
      this.clear(room);
      return { status: this.status(room) };
    }
    if (!this.config) throw new Error('Jira is not configured for this server');
    if (message.action === 'connect') {
      let returnUrl: string | undefined;
      if (message.returnUrl !== undefined) {
        try {
          const target = new URL(message.returnUrl);
          const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
          if (target.origin !== origin || !this.frontendOrigins.includes(target.origin) ||
              (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback)) ||
              target.username || target.password || target.hash || target.searchParams.get('room') !== room.id) {
            throw new Error('Invalid return URL');
          }
          target.search = new URLSearchParams({ room: room.id }).toString();
          returnUrl = target.href;
        } catch {
          throw new Error('The Jira return URL must be this planning room on an allowed app origin');
        }
      }
      const owner = room.snapshot(userId).users.find((member) => member.id === userId);
      if (!owner || owner.away) throw new Error('Rejoin the room before connecting Jira');
      if (this.sessions.get(room)?.busy) throw new Error('Wait for the current Jira operation before reconnecting');
      this.clear(room);
      const member = room.findByName(owner.name);
      if (!member) throw new Error('Rejoin the room before connecting Jira');
      const session: Session = { ownerId: userId, ownerToken: member.token, expiresAt: Date.now() + OAUTH_LIFETIME, sites: [], busy: false, returnUrl };
      this.sessions.set(room, session);
      this.armExpiry(room, session);
      const code = randomId();
      this.starts.set(code, { room, session, expiresAt: session.expiresAt });
      return { authorizeUrl: `${new URL(this.config.redirectUri).origin}/jira/oauth/start?code=${code}`, status: this.status(room) };
    }
    this.reconcile(room);
    const session = this.sessions.get(room);
    if (!session?.accessToken) throw new Error('Connect Jira first. If access expired, reauthorise to continue.');
    if (message.action === 'suggest') {
      if (!session.site) throw new Error('Select an authorised Jira site first');
      return this.suggest(room, session, message.query);
    }
    if (session.busy) throw new Error('A Jira operation is already in progress. Wait for its result.');
    session.busy = true;
    try {
      if (message.action === 'selectSite') {
        const site = session.sites.find((candidate) => candidate.id === message.siteId);
        if (!site) throw new Error('Select a site authorised by your Jira account');
        if (session.site && session.site.id !== site.id) throw new Error('Disconnect Jira before changing sites');
        session.site = site;
        delete session.confirmation;
        delete session.editConfirmation;
        this.changed(room, this.status(room));
        return { status: this.status(room) };
      }
      if (!session.site) throw new Error('Select an authorised Jira site first');
      if (message.action === 'import') return await this.importIssue(room, session, userId, message.input);
      if (message.action === 'agree') {
        const ticket = this.linkedStory(room, session, message.ticketId, false);
        const error = room.agreeEstimate(userId, ticket.id, message.points);
        if (error) throw new Error(error);
        delete session.confirmation;
        return { ticketId: ticket.id };
      }
      if (message.action === 'prepare') return await this.prepare(room, session, message.ticketId, message.fieldId);
      if (message.action === 'confirm') return await this.confirm(room, session, message.confirmationId);
      if (message.action === 'details') return await this.details(room, session, message.ticketId);
      if (message.action === 'prepareEdit') return await this.prepareEdit(room, session, message.ticketId, message.title, message.description, message.extraFields);
      if (message.action === 'confirmEdit') return await this.confirmEdit(room, session, message.confirmationId);
      throw new Error('Unknown Jira action');
    } finally {
      session.busy = false;
    }
  }

  private async suggest(room: Room, session: Session, query: string): Promise<JiraResult> {
    if (query.length > 64 || !/^[A-Z][A-Z0-9_]*-\d*$/i.test(query)) throw new Error('Enter a Jira issue-key prefix such as AL-');
    session.suggestionRequest?.abort();
    const controller = new AbortController();
    session.suggestionRequest = controller;
    try {
      const prefix = query.toUpperCase();
      const dash = prefix.indexOf('-');
      const project = prefix.slice(0, dash);
      const digits = prefix.slice(dash + 1);
      const params = new URLSearchParams({ showSubTasks: 'false',
        currentJQL: `project = "${project}" ORDER BY key ASC` });
      // Jira's picker text-matches "query" against tokenised key/summary text; a bare "PROJ-"
      // prefix with no digits yet fails that match even though currentJQL already scopes the
      // project, so only pass query once the user has typed at least one digit.
      if (digits) params.set('query', prefix);
      const response = await this.api(room, session, `/rest/api/3/issue/picker?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || session.suggestionRequest !== controller) return { suggestions: [] };
      if (!record(response) || !Array.isArray(response.sections)) throw new Error('Jira returned invalid issue suggestions');
      const matches = new Map<string, JiraSuggestion>();
      for (const section of response.sections) {
        if (!record(section) || section.id !== 'cs' || !Array.isArray(section.issues)) continue;
        for (const issue of section.issues) {
          if (!record(issue) || typeof issue.key !== 'string' || issue.key.length > 128 ||
              !/^[A-Z][A-Z0-9_]*-\d+$/i.test(issue.key)) continue;
          const key = issue.key.toUpperCase();
          if (!key.startsWith(prefix) || room.tickets.some((ticket) => ticket.jira?.cloudId === session.site!.id && ticket.jira.key === key)) continue;
          matches.set(key, { key, summary: typeof issue.summaryText === 'string' ? issue.summaryText.slice(0, 255) : '' });
        }
      }
      return { suggestions: [...matches.values()].sort((first, second) => first.key.localeCompare(second.key, 'en', { numeric: true })).slice(0, 10) };
    } finally {
      if (session.suggestionRequest === controller) delete session.suggestionRequest;
    }
  }

  private async importIssue(room: Room, session: Session, userId: string, input: string): Promise<JiraResult> {
    const site = session.site!;
    const key = parseJiraIssueKey(input, site.url);
    const issue = await this.api(room, session, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,issuetype`);
    if (!record(issue) || typeof issue.id !== 'string' || typeof issue.key !== 'string' ||
        !/^[A-Z][A-Z0-9_]*-\d+$/i.test(issue.key) || !record(issue.fields)) throw new Error('Jira returned an invalid issue');
    const fields = issue.fields;
    if (typeof fields.summary !== 'string' || !fields.summary.trim() || Array.from(fields.summary).length > 255) throw new Error('Jira summary is missing or exceeds 255 characters');
    const issueTypeName = record(fields.issuetype) && typeof fields.issuetype.name === 'string' ? fields.issuetype.name.toLowerCase() : '';
    // A "[SPIKE]" title convention overrides the Jira issue type when teams don't have a native Spike type.
    const typeName = /\[spike\]/i.test(fields.summary) ? 'spike' : issueTypeName;
    if (!isTicketType(typeName)) throw new Error('Unsupported ticket type. Only Story, Spike, Bug and Task are supported.');
    validateJiraDescription(fields.description);
    const candidates = await this.discoverExtraFields(room, session);
    const snapshot = await this.readIssue(room, session, issue.id, candidates);
    const extraFields = snapshot.extras.filter((extra) => extra.adf !== undefined)
      .map(({ id, name, adf }) => ({ id, name, adf: adf! }));
    this.valid(room, session);
    const ticket = room.importTicket(userId, {
      type: typeName,
      title: fields.summary,
      description: '',
      descriptionAdf: snapshot.descriptionAdf,
      ...(extraFields.length ? { extraFields } : {}),
      jira: { cloudId: site.id, issueId: issue.id, key: issue.key, url: `${site.url}/browse/${encodeURIComponent(issue.key)}` },
    });
    return { ticketId: ticket.id };
  }

  private linkedStory(room: Room, session: Session, ticketId: string, agreed = true): RoomTicket {
    const ticket = room.tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket?.jira || ticket.type === 'spike') throw new Error('Only linked stories support story-points write-back');
    if (ticket.jira.cloudId !== session.site?.id) throw new Error('Reconnect to this ticket\'s Jira site before writing points');
    if (!ticket.result || room.activeTicketId !== ticket.id || !room.revealed) throw new Error('Reveal this story before writing points');
    if (agreed && (ticket.agreedEstimate === undefined || !(STORY_POINT_VALUES as readonly number[]).includes(ticket.agreedEstimate))) throw new Error('Choose and agree a numeric story-deck value first');
    return ticket;
  }

  private async editableFields(room: Room, session: Session, ticket: RoomTicket): Promise<JiraField[]> {
    const fields = await this.api(room, session, '/rest/api/3/field');
    if (!Array.isArray(fields)) throw new Error('Jira returned invalid field metadata');
    const meta = await this.api(room, session, `/rest/api/3/issue/${encodeURIComponent(ticket.jira!.issueId)}/editmeta`);
    const editable = record(meta) && record(meta.fields) ? meta.fields : {};
    const result: JiraField[] = [];
    for (const field of fields) {
      if (!record(field) || typeof field.id !== 'string' || typeof field.name !== 'string' || !record(field.schema) || field.schema.type !== 'number') continue;
      if (!['story points', 'story point estimate'].includes(field.name.trim().toLowerCase()) && field.schema.custom !== 'com.atlassian.jira.plugin.system.customfieldtypes:storypoints') continue;
      const edit = editable[field.id];
      if (record(edit) && Array.isArray(edit.operations) && edit.operations.includes('set')) result.push({ id: field.id, name: field.name });
    }
    return result;
  }

  private jiraTicket(room: Room, session: Session, ticketId: string): RoomTicket {
    const ticket = room.tickets.find((candidate) => candidate.id === ticketId);
    if (!ticket?.jira) throw new Error('This ticket is not linked to Jira');
    if (ticket.jira.cloudId !== session.site?.id) throw new Error('Reconnect to this ticket\'s Jira site before editing');
    return ticket;
  }

  private async discoverExtraFields(room: Room, session: Session): Promise<JiraField[]> {
    const fields = await this.api(room, session, '/rest/api/3/field');
    if (!Array.isArray(fields)) throw new Error('Jira returned invalid field metadata');
    return fields
      .filter((field): field is { id: string; name: string } => record(field) && typeof field.id === 'string' &&
        typeof field.name === 'string' && field.id !== 'description' && field.id !== 'summary' &&
        (/description/i.test(field.name) || /^acceptance criteria$/i.test(field.name)) &&
        record(field.schema) && field.schema.type === 'string')
      .sort((first, second) => Number(/description/i.test(second.name)) - Number(/description/i.test(first.name)) || first.id.localeCompare(second.id));
  }

  private async fieldEditable(room: Room, session: Session, ticket: RoomTicket, field: JiraField): Promise<boolean> {
    const meta = await this.api(room, session, `/rest/api/3/issue/${encodeURIComponent(ticket.jira!.issueId)}/editmeta`);
    const editable = record(meta) && record(meta.fields) ? meta.fields : {};
    const edit = editable[field.id];
    return record(edit) && Array.isArray(edit.operations) && edit.operations.includes('set');
  }

  private async readIssue(room: Room, session: Session, issueId: string, candidates: JiraField[] = []): Promise<{
    title: string; descriptionAdf: AdfDocument; description: string;
    extras: Array<{ id: string; name: string; text: string; adf?: AdfDocument; kind: 'string' | 'adf' }>;
  }> {
    let title = '';
    let descriptionAdf: AdfDocument = { type: 'doc', version: 1, content: [] };
    const extras: Array<{ id: string; name: string; text: string; adf?: AdfDocument; kind: 'string' | 'adf' }> = [];
    for (let offset = 0; offset < Math.max(candidates.length, 1); offset += 40) {
      const batch = candidates.slice(offset, offset + 40);
      const fieldsParam = ['summary', 'description', ...batch.map((field) => field.id)].join(',');
      const issue = await this.api(room, session, `/rest/api/3/issue/${encodeURIComponent(issueId)}?fields=${encodeURIComponent(fieldsParam)}`);
      if (!record(issue) || !record(issue.fields) || typeof issue.fields.summary !== 'string' ||
          !issue.fields.summary.trim() || Array.from(issue.fields.summary).length > 255) throw new Error('Jira summary is missing or exceeds 255 characters');
      if (offset === 0) {
        title = issue.fields.summary;
        descriptionAdf = validateJiraDescription(issue.fields.description);
      }
      extras.push(...batch.map((field) => {
        const value = textFieldValue(issue, field.id);
        return { id: field.id, name: field.name, text: value?.text ?? '', adf: value?.adf, kind: value?.kind ?? 'string' as const };
      }));
    }
    return { title, descriptionAdf, description: adfToPlainText(descriptionAdf), extras };
  }

  private async details(room: Room, session: Session, ticketId: string): Promise<JiraResult> {
    const ticket = this.jiraTicket(room, session, ticketId);
    const candidates = await this.discoverExtraFields(room, session);
    const snapshot = await this.readIssue(room, session, ticket.jira!.issueId, candidates);
    const present = snapshot.extras.filter((extra) => extra.adf !== undefined);
    const extraFields: JiraExtraField[] = present.map(({ id, name, adf }) => ({ id, name, adf: adf! }));
    room.applyJiraFieldUpdate(ticket.id, {
      title: snapshot.title, descriptionAdf: snapshot.descriptionAdf, extraFields: extraFields.length ? extraFields : undefined,
    });
    return { detail: { title: snapshot.title, descriptionAdf: snapshot.descriptionAdf,
      ...(extraFields.length ? { extraFields } : {}) } };
  }

  private async prepareEdit(room: Room, session: Session, ticketId: string, title: string, description: string, extraFields?: Record<string, string>): Promise<JiraResult> {
    const ticket = this.jiraTicket(room, session, ticketId);
    const revision = ticket.revision ?? 0;
    delete session.editConfirmation;
    const submitted = Object.entries(extraFields ?? {});
    const candidates = submitted.length ? await this.discoverExtraFields(room, session) : [];
    const editFields: JiraField[] = [];
    for (const [id] of submitted) {
      const field = candidates.find((candidate) => candidate.id === id);
      if (!field || !(await this.fieldEditable(room, session, ticket, field))) throw new Error('One of the submitted fields is not editable on this issue');
      editFields.push(field);
    }
    const current = await this.readIssue(room, session, ticket.jira!.issueId, editFields);
    this.jiraTicket(room, session, ticketId);
    if ((ticket.revision ?? 0) !== revision) throw new Error('The ticket changed. Review it and prepare again.');
    const changes: JiraEditChange[] = [];
    if (title !== current.title) changes.push({ fieldId: 'summary', fieldName: 'Summary', from: current.title, to: title });
    if (description !== current.description) changes.push({ fieldId: 'description', fieldName: 'Description', from: current.description, to: description });
    const fields: EditField[] = [];
    for (const extra of current.extras) {
      fields.push({ id: extra.id, name: extra.name, kind: extra.kind });
      const value = extraFields?.[extra.id];
      if (value !== undefined && value !== extra.text) changes.push({ fieldId: extra.id, fieldName: extra.name, from: extra.text, to: value });
    }
    if (!changes.length) throw new Error('No changes to write back');
    const preview: JiraEditPreview = { id: randomId(), issueKey: ticket.jira!.key, issueUrl: ticket.jira!.url, siteName: session.site!.name, changes };
    session.editConfirmation = {
      preview, ticket, revision, expiresAt: Date.now() + 2 * 60 * 1_000,
      values: { title, description, extraFields: Object.fromEntries(submitted) }, fields,
    };
    return { editPreview: preview };
  }

  private async confirmEdit(room: Room, session: Session, confirmationId: string): Promise<JiraResult> {
    const confirmation = session.editConfirmation;
    delete session.editConfirmation;
    if (!confirmation || confirmation.preview.id !== confirmationId || confirmation.expiresAt <= Date.now()) throw new Error('Confirmation expired or was already used. Prepare a new confirmation.');
    const { ticket, preview, revision, values, fields } = confirmation;
    const check = () => {
      this.valid(room, session);
      if (this.jiraTicket(room, session, ticket.id) !== ticket || (ticket.revision ?? 0) !== revision) throw new Error('The ticket changed. Prepare a new confirmation.');
    };
    check();
    const current = await this.readIssue(room, session, ticket.jira!.issueId, fields);
    check();
    const latest: Record<string, string> = { summary: current.title, description: current.description };
    for (const extra of current.extras) latest[extra.id] = extra.text;
    if (preview.changes.some((change) => latest[change.fieldId] !== change.from)) throw new Error('Jira fields changed since the preview. Prepare and confirm the new values.');
    const body: Record<string, unknown> = {};
    for (const change of preview.changes) {
      if (change.fieldId === 'summary') body.summary = values.title;
      else if (change.fieldId === 'description') body.description = plainTextToAdf(values.description);
      else {
        const field = fields.find((candidate) => candidate.id === change.fieldId);
        const value = values.extraFields[change.fieldId] ?? '';
        body[change.fieldId] = field?.kind === 'adf' ? plainTextToAdf(value) : value;
      }
    }
    const issuePath = `/rest/api/3/issue/${encodeURIComponent(ticket.jira!.issueId)}`;
    let putSucceeded = false;
    try {
      await this.api(room, session, issuePath, { method: 'PUT', body: JSON.stringify({ fields: body }) });
      putSucceeded = true;
      const verified = await this.readIssue(room, session, ticket.jira!.issueId, fields);
      check();
      const present = verified.extras.filter((extra) => extra.adf !== undefined);
      const verifiedExtraFields: JiraExtraField[] = [
        ...(ticket.extraFields ?? []).filter((field) => !fields.some((edited) => edited.id === field.id)),
        ...present.map(({ id, name, adf }) => ({ id, name, adf: adf! })),
      ];
      room.applyJiraFieldUpdate(ticket.id, {
        title: verified.title, descriptionAdf: verified.descriptionAdf,
        extraFields: verifiedExtraFields.length ? verifiedExtraFields : undefined,
      });
      const verifiedValues: Record<string, string> = { summary: verified.title, description: verified.description };
      for (const extra of verified.extras) verifiedValues[extra.id] = extra.text;
      const matches = preview.changes.every((change) => {
        const expected = body[change.fieldId];
        if (typeof expected === 'string') return verifiedValues[change.fieldId] === expected;
        const text = adfToPlainText(expected as AdfDocument);
        return verifiedValues[change.fieldId] === (change.fieldId === 'description' ? text : text.trim());
      });
      return matches ? { written: true } : { written: false, uncertain: true };
    } catch (error) {
      if (!putSucceeded && error instanceof Error && /not permitted|not found|rate limiting/.test(error.message)) throw error;
      return { written: false, uncertain: true };
    }
  }

  private async prepare(room: Room, session: Session, ticketId: string, fieldId?: string): Promise<JiraResult> {
    const ticket = this.linkedStory(room, session, ticketId);
    const revision = ticket.revision ?? 0;
    const round = room.round;
    delete session.confirmation;
    const fields = await this.editableFields(room, session, ticket);
    if (!fields.length) throw new Error('No editable story-points field was found for this issue. Your estimate is kept.');
    const field = fieldId ? fields.find((candidate) => candidate.id === fieldId) : fields.length === 1 ? fields[0] : undefined;
    if (fieldId && !field) throw new Error('The selected story-points field is not editable on this issue');
    if (!field) return { fields };
    const issue = await this.api(room, session, `/rest/api/3/issue/${encodeURIComponent(ticket.jira!.issueId)}?fields=${encodeURIComponent(field.id)}`);
    this.linkedStory(room, session, ticketId);
    if ((ticket.revision ?? 0) !== revision || room.round !== round) throw new Error('The estimate changed. Review it and prepare again.');
    const preview: JiraPreview = {
      id: randomId(), issueKey: ticket.jira!.key, issueUrl: ticket.jira!.url, siteName: session.site!.name,
      fieldId: field.id, fieldName: field.name, currentPoints: numericValue(issue, field.id), points: ticket.agreedEstimate!,
    };
    session.confirmation = { preview, ticket, revision, round, expiresAt: Date.now() + 2 * 60 * 1_000 };
    return { preview };
  }

  private async confirm(room: Room, session: Session, confirmationId: string): Promise<JiraResult> {
    const confirmation = session.confirmation;
    delete session.confirmation;
    if (!confirmation || confirmation.preview.id !== confirmationId || confirmation.expiresAt <= Date.now()) throw new Error('Confirmation expired or was already used. Prepare a new confirmation.');
    const { ticket, preview, revision, round } = confirmation;
    const check = () => {
      this.valid(room, session);
      if (this.linkedStory(room, session, ticket.id) !== ticket || (ticket.revision ?? 0) !== revision ||
          room.round !== round || ticket.agreedEstimate !== preview.points) throw new Error('The ticket or estimate changed. Prepare a new confirmation.');
    };
    check();
    const fields = await this.editableFields(room, session, ticket);
    if (!fields.some((field) => field.id === preview.fieldId)) throw new Error('The selected field is no longer editable. Your estimate is kept.');
    const issuePath = `/rest/api/3/issue/${encodeURIComponent(ticket.jira!.issueId)}`;
    const readPath = `${issuePath}?fields=${encodeURIComponent(preview.fieldId)}`;
    const current = numericValue(await this.api(room, session, readPath), preview.fieldId);
    check();
    if (current !== preview.currentPoints) throw new Error('Jira points changed since the preview. Prepare and confirm the new values.');
    let putSucceeded = false;
    try {
      await this.api(room, session, issuePath, {
        method: 'PUT', body: JSON.stringify({ fields: { [preview.fieldId]: preview.points } }),
      });
      putSucceeded = true;
      const actual = numericValue(await this.api(room, session, readPath), preview.fieldId);
      check();
      if (actual !== preview.points) return { written: false, uncertain: true };
      return { written: true };
    } catch (error) {
      if (!putSucceeded && error instanceof Error && /not permitted|not found|rate limiting/.test(error.message)) throw error;
      return { written: false, uncertain: true };
    }
  }

  async handleHttp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const finish = (code: number, message: string) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
    };
    if (req.method !== 'GET' || !this.config) return finish(404, 'Not found');
    if (url.pathname === '/jira/oauth/start') {
      const code = url.searchParams.get('code') ?? '';
      const pending = this.starts.get(code);
      this.starts.delete(code);
      if (!pending || pending.expiresAt <= Date.now()) return finish(400, 'Invalid or expired Jira connection request. Connect again from the room.');
      this.valid(pending.room, pending.session);
      const state = randomId();
      pending.state = state;
      this.states.set(state, pending);
      const authorize = new URL('https://auth.atlassian.com/authorize');
      authorize.search = new URLSearchParams({ audience: 'api.atlassian.com', client_id: this.config.clientId,
        scope: 'read:jira-work write:jira-work', redirect_uri: this.config.redirectUri, state, response_type: 'code', prompt: 'consent' }).toString();
      const secure = this.config.redirectUri.startsWith('https:') ? '; Secure' : '';
      res.writeHead(302, { Location: authorize.href,
        'Set-Cookie': `jira_oauth_${state}=${state}; Path=/jira/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure}` });
      res.end();
      return;
    }
    if (url.pathname !== '/jira/oauth/callback') return finish(404, 'Not found');
    const state = url.searchParams.get('state') ?? '';
    const pending = this.states.get(state);
    const expectedCookie = `jira_oauth_${state}=${state}`;
    if (!/^[\w-]{32}$/.test(state) || !pending || pending.expiresAt <= Date.now() ||
        !req.headers.cookie?.split(';').some((cookie) => cookie.trim() === expectedCookie)) {
      return finish(400, 'Invalid or expired OAuth state. Connect again from the room.');
    }
    this.states.delete(state);
    res.setHeader('Set-Cookie', `${expectedCookie}; Path=/jira/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0${this.config.redirectUri.startsWith('https:') ? '; Secure' : ''}`);
    const { room, session } = pending;
    try {
      this.valid(room, session);
      if (url.searchParams.has('error')) throw new Error('Jira authorisation was not completed. Connect again.');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4_096) throw new Error('Jira authorisation callback was incomplete');
      const started = Date.now();
      const token = await this.json('https://auth.atlassian.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', client_id: this.config.clientId,
          client_secret: this.config.clientSecret, code, redirect_uri: this.config.redirectUri }),
      });
      this.valid(room, session);
      if (!record(token) || typeof token.access_token !== 'string' || !token.access_token ||
          typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 86_400) throw new Error('Jira returned invalid authorisation');
      const resources = await this.json('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token.access_token}` },
      });
      this.valid(room, session);
      if (!Array.isArray(resources)) throw new Error('Jira returned invalid authorised sites');
      const sites: JiraSite[] = [];
      for (const resource of resources) {
        if (!record(resource) || typeof resource.id !== 'string' || resource.id.length > 128 ||
            typeof resource.name !== 'string' || typeof resource.url !== 'string' || !Array.isArray(resource.scopes) ||
            !resource.scopes.includes('read:jira-work') || !resource.scopes.includes('write:jira-work')) continue;
        const siteUrl = new URL(resource.url);
        if (siteUrl.protocol !== 'https:' || siteUrl.username || siteUrl.password || siteUrl.pathname !== '/' || siteUrl.search || siteUrl.hash) continue;
        if (!sites.some((site) => site.id === resource.id)) sites.push({ id: resource.id, name: resource.name, url: siteUrl.origin });
      }
      if (!sites.length) throw new Error('No Jira site with issue read and write access was authorised');
      session.accessToken = token.access_token;
      session.expiresAt = started + token.expires_in * 1_000;
      session.sites = sites;
      if (sites.length === 1) session.site = sites[0];
      this.armExpiry(room, session);
      this.changed(room, this.status(room));
      const nonce = randomId();
      const target = session.returnUrl;
      const returnLink = target ? `<p><a href="${htmlText(target)}" rel="noreferrer">Return to your planning room</a></p>` : '';
      const redirect = target ? `setTimeout(() => location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')}), 250);` : '';
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Jira connected</title></head><body><h1>Jira connected</h1>${returnLink}<script nonce="${nonce}">window.close();${redirect}</script></body></html>`);
    } catch {
      if (this.sessions.get(room) === session) this.clear(room, 'Jira authorisation failed or was cancelled. Connect again.');
      finish(400, 'Jira authorisation failed or expired. Return to your room and connect again.');
    }
  }
}