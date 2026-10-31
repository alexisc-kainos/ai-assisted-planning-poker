export interface RosterUser {
  id: string;
  name: string;
  avatar?: string;
  hasVoted: boolean;
}

export interface Ticket {
  type: 'story';
  content: string;
}

export interface RoomState {
  type: 'state';
  hostId: string | null;
  revealed: boolean;
  deck?: string;
  ticket: Ticket | null;
  users: RosterUser[];
  votes: Record<string, string> | null;
  myVote: string | null;
}

export type ServerMessage =
  | { type: 'welcome'; userId: string }
  | RoomState
  | { type: 'error'; message: string };

export type ClientMessage = { type: 'vote'; value: string } | { type: 'setTicket'; ticket: Ticket };

export interface RoomStatus {
  exists: boolean;
  userCount: number;
  capacity: number;
  full: boolean;
}
