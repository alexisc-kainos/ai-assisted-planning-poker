export type TicketType = 'story' | 'spike' | 'bug' | 'task';

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

export interface JiraSite { id: string; name: string; url: string }
export interface JiraStatus {
  available: boolean;
  connected: boolean;
  site?: JiraSite;
  sites?: JiraSite[];
  reason?: string;
}
export interface JiraField { id: string; name: string }
export interface JiraExtraField { id: string; name: string; adf: AdfDocument }
export interface JiraEditChange { fieldId: string; fieldName: string; from: string; to: string }
export interface JiraEditPreview {
  id: string;
  issueKey: string;
  issueUrl: string;
  siteName: string;
  changes: JiraEditChange[];
}
export interface JiraTicketDetail {
  title: string;
  descriptionAdf: AdfDocument;
  extraFields?: JiraExtraField[];
}
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
export interface JiraResult {
  status?: JiraStatus;
  authorizeUrl?: string;
  ticketId?: string;
  fields?: JiraField[];
  suggestions?: Array<{ key: string; summary: string }>;
  preview?: JiraPreview;
  written?: boolean;
  uncertain?: boolean;
  detail?: JiraTicketDetail;
  editPreview?: JiraEditPreview;
}

export type JiraClientMessage = { type: 'jira'; requestId: string } & (
  | { action: 'status' | 'disconnect' }
  | { action: 'connect'; returnUrl?: string }
  | { action: 'suggest'; query: string }
  | { action: 'selectSite'; siteId: string }
  | { action: 'import'; input: string }
  | { action: 'agree'; ticketId: string; points: number }
  | { action: 'prepare'; ticketId: string; fieldId?: string }
  | { action: 'confirm'; confirmationId: string }
  | { action: 'details'; ticketId: string }
  | { action: 'prepareEdit'; ticketId: string; title: string; description: string; extraFields?: Record<string, string> }
  | { action: 'confirmEdit'; confirmationId: string }
);
export type JiraRequest = JiraClientMessage extends infer Message
  ? Message extends JiraClientMessage ? Omit<Message, 'type' | 'requestId'> : never
  : never;

export interface RosterUser {
  id: string;
  name: string;
  avatar?: string;
  hasVoted: boolean;
  spectating: boolean;
  away: boolean;
}

export type TicketFields = Pick<Ticket, 'title' | 'description'>;

export interface Ticket {
  type: TicketType;
  title: string;
  description: string;
}

export interface TicketResult {
  users: Array<Pick<RosterUser, 'id' | 'name' | 'avatar'>>;
  votes: Record<string, string>;
}

export interface RoomTicket extends Ticket {
  id: string;
  result: TicketResult | null;
  jira?: { cloudId: string; issueId: string; key: string; url: string };
  descriptionAdf?: AdfDocument;
  extraFields?: JiraExtraField[];
  agreedEstimate?: number;
  revision?: number;
}

export interface RoomState {
  type: 'state';
  hostId: string | null;
  revealed: boolean;
  deck?: string;
  tickets: RoomTicket[];
  activeTicketId: string | null;
  round: number;
  users: RosterUser[];
  votes: Record<string, string> | null;
  myVote: string | null;
}

export type ServerMessage =
  | { type: 'welcome'; userId: string; token: string }
  | { type: 'replaced' }
  | { type: 'jiraStatus'; status: JiraStatus }
  | { type: 'jira'; requestId: string; ok: boolean; data?: JiraResult; error?: string }
  | RoomState
  | { type: 'error'; message: string };

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

export interface RoomMemberName {
  name: string;
  away: boolean;
}

export interface RoomStatus {
  exists: boolean;
  userCount: number;
  capacity: number;
  full: boolean;
  members?: RoomMemberName[];
}
