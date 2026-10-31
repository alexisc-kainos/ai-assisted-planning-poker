import { randomBytes } from 'node:crypto';
import type { Ticket } from './validation.js';

export interface Member {
  id: string;
  seq: number;
  name: string;
  avatar?: string;
  vote?: string;
}

export interface StateMessage {
  type: 'state';
  hostId: string | null;
  revealed: boolean;
  deck?: string;
  ticket: Ticket | null;
  users: Array<{ id: string; name: string; avatar?: string; hasVoted: boolean }>;
  votes: Record<string, string> | null;
}

export class Room {
  private readonly members = new Map<string, Member>();
  private nextSeq = 1;
  hostId: string | null = null;
  revealed = false;
  ticket: Ticket | null = null;

  constructor(
    readonly id: string,
    readonly deck?: string,
  ) {}

  get size(): number {
    return this.members.size;
  }

  add(name: string, avatar?: string): Member {
    let id: string;
    do {
      id = `user-${randomBytes(6).toString('hex')}`;
    } while (this.members.has(id));

    const member: Member = { id, seq: this.nextSeq++, name, avatar };
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
  vote(userId: string, value: string): string | null {
    if (this.revealed) return 'Voting is locked until reset';
    const member = this.members.get(userId);
    if (member) member.vote = value;
    return null;
  }

  reveal(userId: string): string | null {
    if (userId !== this.hostId) return 'Only the host can reveal votes';
    if (this.revealed) return 'Votes are already revealed';
    this.revealed = true;
    return null;
  }

  reset(userId: string): string | null {
    if (userId !== this.hostId) return 'Only the host can reset votes';
    const hasVotes = [...this.members.values()].some((member) => member.vote !== undefined);
    if (!this.revealed && !hasVotes) return 'Votes are already reset';
    this.revealed = false;
    for (const member of this.members.values()) delete member.vote;
    return null;
  }

  setTicket(userId: string, ticket: Ticket): string | null {
    if (userId !== this.hostId) return 'Only the host can set the ticket';
    this.ticket = ticket;
    return null;
  }

  snapshot(): StateMessage {
    const members = [...this.members.values()].sort((a, b) => a.seq - b.seq);
    const state: StateMessage = {
      type: 'state',
      hostId: this.hostId,
      revealed: this.revealed,
      ticket: this.ticket,
      users: members.map(({ id, name, avatar, vote }) => ({
        id,
        name,
        ...(avatar ? { avatar } : {}),
        hasVoted: vote !== undefined,
      })),
      votes: this.revealed
        ? Object.fromEntries(
            members.filter((m) => m.vote !== undefined).map((m) => [m.id, m.vote as string]),
          )
        : null,
    };
    if (this.deck) state.deck = this.deck;
    return state;
  }
}
