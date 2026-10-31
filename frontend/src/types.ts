export interface RosterUser {
  id: string;
  name: string;
  avatar?: string;
  hasVoted: boolean;
}

export interface RoomState {
  type: 'state';
  hostId: string | null;
  revealed: boolean;
  deck?: string;
  users: RosterUser[];
  votes: Record<string, string> | null;
}

export type ServerMessage =
  | { type: 'welcome'; userId: string }
  | RoomState
  | { type: 'error'; message: string };

export interface RoomStatus {
  exists: boolean;
  userCount: number;
  capacity: number;
  full: boolean;
}
