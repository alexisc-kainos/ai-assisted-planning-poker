export type TicketType = 'story' | 'spike';

export interface RosterUser {
  id: string;
  name: string;
  avatar?: string;
  hasVoted: boolean;
}

export interface Ticket {
  type: TicketType;
  content: string;
}

export interface TicketResult {
  users: Array<Pick<RosterUser, 'id' | 'name' | 'avatar'>>;
  votes: Record<string, string>;
}

export interface RoomTicket extends Ticket {
  id: string;
  result: TicketResult | null;
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
  | { type: 'welcome'; userId: string }
  | RoomState
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'vote'; value: string; round: number }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'addTicket'; ticket: Ticket }
  | { type: 'editTicket'; ticketId: string; content: string; ticketType?: TicketType }
  | { type: 'removeTicket'; ticketId: string }
  | { type: 'selectTicket'; ticketId: string };

export interface RoomStatus {
  exists: boolean;
  userCount: number;
  capacity: number;
  full: boolean;
}
