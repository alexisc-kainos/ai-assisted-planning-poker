import { randomBytes } from 'node:crypto';
import { MAX_TICKETS, type Ticket, type TicketType } from './validation.js';

export interface Member {
  id: string;
  seq: number;
  name: string;
  avatar?: string;
  vote?: string;
  spectating: boolean;
}

export interface TicketResult {
  users: Array<{ id: string; name: string; avatar?: string }>;
  votes: Record<string, string>;
}

export interface RoomTicket extends Ticket {
  id: string;
  result: TicketResult | null;
}

export interface StateMessage {
  type: 'state';
  hostId: string | null;
  revealed: boolean;
  deck?: string;
  tickets: RoomTicket[];
  activeTicketId: string | null;
  round: number;
  users: Array<{ id: string; name: string; avatar?: string; hasVoted: boolean; spectating: boolean }>;
  votes: Record<string, string> | null;
  myVote: string | null;
}

export class Room {
  private readonly members = new Map<string, Member>();
  private nextSeq = 1;
  hostId: string | null = null;
  revealed = false;
  tickets: RoomTicket[] = [];
  activeTicketId: string | null = null;
  round = 0;

  constructor(
    readonly id: string,
    readonly deck?: string,
  ) {}

  get size(): number {
    return this.members.size;
  }

  add(name: string, avatar?: string, spectating = false): Member {
    let id: string;
    do {
      id = `user-${randomBytes(6).toString('hex')}`;
    } while (this.members.has(id));

    const member: Member = { id, seq: this.nextSeq++, name, avatar, spectating };
    this.members.set(id, member);
    this.hostId ??= id;
    return member;
  }

  remove(userId: string): void {
    this.members.delete(userId);
    if (this.hostId !== userId) return;
    let next: Member | undefined;
    for (const member of this.members.values()) {
      if (!next || member.seq < next.seq) next = member;
    }
    this.hostId = next?.id ?? null;
  }

  /** Each action returns an error message, or null when state changed. */
  vote(userId: string, value: string, round: number): string | null {
    if (round !== this.round) return 'Vote was for a previous round';
    if (this.revealed) return 'Voting is locked until reset';
    const member = this.members.get(userId);
    if (member?.spectating) return 'Spectators cannot vote';
    if (member) member.vote = value;
    return null;
  }

  setSpectating(userId: string, spectating: boolean): string | null {
    const member = this.members.get(userId);
    if (!member) return null;
    member.spectating = spectating;
    // Revealed votes stay put so results don't shift until reset.
    if (spectating && !this.revealed) delete member.vote;
    return null;
  }

  reveal(userId: string): string | null {
    if (userId !== this.hostId) return 'Only the host can reveal votes';
    if (this.revealed) return 'Votes are already revealed';
    this.revealed = true;
    const active = this.tickets.find((ticket) => ticket.id === this.activeTicketId);
    if (active) {
      const members = this.orderedMembers().filter((m) => !m.spectating || m.vote !== undefined);
      active.result = {
        users: members.map(({ id, name, avatar }) => ({ id, name, ...(avatar ? { avatar } : {}) })),
        votes: this.revealedVotes(members),
      };
    }
    return null;
  }

  reset(userId: string): string | null {
    if (userId !== this.hostId) return 'Only the host can reset votes';
    const hasVotes = [...this.members.values()].some((member) => member.vote !== undefined);
    if (!this.revealed && !hasVotes) return 'Votes are already reset';
    this.clearRound();
    return null;
  }

  addTicket(userId: string, ticket: Ticket): string | null {
    if (userId !== this.hostId) return 'Only the host can add tickets';
    if (this.tickets.length >= MAX_TICKETS) return `A room can have at most ${MAX_TICKETS} tickets`;
    let id: string;
    do {
      id = `ticket-${randomBytes(6).toString('hex')}`;
    } while (this.tickets.some((existing) => existing.id === id));
    this.tickets.push({ id, ...ticket, result: null });
    return null;
  }

  editTicket(userId: string, ticketId: string, title: string, description: string, type?: TicketType): string | null {
    if (userId !== this.hostId) return 'Only the host can edit tickets';
    const ticket = this.tickets.find((existing) => existing.id === ticketId);
    if (!ticket) return 'Ticket not found';
    ticket.title = title;
    ticket.description = description;
    if (type && type !== ticket.type) {
      ticket.type = type;
      // Votes and results in the old deck's units are meaningless after a type change.
      ticket.result = null;
      if (this.activeTicketId === ticketId) this.clearRound();
    }
    return null;
  }

  removeTicket(userId: string, ticketId: string): string | null {
    if (userId !== this.hostId) return 'Only the host can remove tickets';
    const index = this.tickets.findIndex((existing) => existing.id === ticketId);
    if (index === -1) return 'Ticket not found';
    this.tickets.splice(index, 1);
    if (this.activeTicketId === ticketId) {
      this.activeTicketId = null;
      this.clearRound();
    }
    return null;
  }

  selectTicket(userId: string, ticketId: string): string | null {
    if (userId !== this.hostId) return 'Only the host can select tickets';
    if (!this.tickets.some((existing) => existing.id === ticketId)) return 'Ticket not found';
    if (this.activeTicketId === ticketId) return 'Ticket is already active';
    this.activeTicketId = ticketId;
    this.clearRound();
    return null;
  }

  snapshot(forUserId: string): StateMessage {
    const members = this.orderedMembers();
    const state: StateMessage = {
      type: 'state',
      hostId: this.hostId,
      revealed: this.revealed,
      tickets: this.tickets,
      activeTicketId: this.activeTicketId,
      round: this.round,
      users: members.map(({ id, name, avatar, vote, spectating }) => ({
        id,
        name,
        ...(avatar ? { avatar } : {}),
        hasVoted: vote !== undefined,
        spectating,
      })),
      votes: this.revealed ? this.revealedVotes(members) : null,
      myVote: this.members.get(forUserId)?.vote ?? null,
    };
    if (this.deck) state.deck = this.deck;
    return state;
  }

  private orderedMembers(): Member[] {
    return [...this.members.values()].sort((a, b) => a.seq - b.seq);
  }

  private revealedVotes(members: Member[]): Record<string, string> {
    return Object.fromEntries(
      members.filter((m) => m.vote !== undefined).map((m) => [m.id, m.vote as string]),
    );
  }

  private clearRound(): void {
    this.round += 1;
    this.revealed = false;
    for (const member of this.members.values()) delete member.vote;
  }
}
