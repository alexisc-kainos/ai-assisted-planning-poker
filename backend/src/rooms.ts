import { randomBytes } from 'node:crypto';
import { MAX_TICKETS, STORY_POINT_VALUES, type AdfDocument, type JiraLink, type Ticket, type TicketType } from './validation.js';

export interface Member {
  id: string;
  seq: number;
  token: string;
  name: string;
  avatar?: string;
  vote?: string;
  spectating: boolean;
  connected: boolean;
}

export const normaliseName = (name: string): string => name.trim().toLowerCase();

export interface TicketResult {
  users: Array<{ id: string; name: string; avatar?: string }>;
  votes: Record<string, string>;
}

export interface RoomTicket extends Ticket {
  id: string;
  result: TicketResult | null;
  jira?: JiraLink;
  descriptionAdf?: AdfDocument;
  agreedEstimate?: number;
  revision?: number;
}

export interface StateMessage {
  type: 'state';
  hostId: string | null;
  revealed: boolean;
  deck?: string;
  tickets: RoomTicket[];
  activeTicketId: string | null;
  round: number;
  users: Array<{ id: string; name: string; avatar?: string; hasVoted: boolean; spectating: boolean; away: boolean }>;
  votes: Record<string, string> | null;
  myVote: string | null;
}

export class Room {
  private readonly members = new Map<string, Member>();
  private nextSeq = 1;
  private originalHostId: string | null = null;
  hostId: string | null = null;
  revealed = false;
  tickets: RoomTicket[] = [];
  activeTicketId: string | null = null;
  round = 0;

  constructor(
    readonly id: string,
    readonly deck?: string,
  ) {}

  /** Includes away members, who keep their place. */
  get size(): number {
    return this.members.size;
  }

  get connectedCount(): number {
    let count = 0;
    for (const member of this.members.values()) if (member.connected) count += 1;
    return count;
  }

  add(name: string, avatar?: string, spectating = false): Member {
    let id: string;
    do {
      id = `user-${randomBytes(6).toString('hex')}`;
    } while (this.members.has(id));

    const token = randomBytes(24).toString('base64url');
    const member: Member = { id, seq: this.nextSeq++, token, name, avatar, spectating, connected: true };
    this.members.set(id, member);
    this.hostId ??= id;
    this.originalHostId ??= id;
    return member;
  }

  findByToken(token: string): Member | undefined {
    for (const member of this.members.values()) if (member.token === token) return member;
    return undefined;
  }

  findByName(name: string): Member | undefined {
    const wanted = normaliseName(name);
    for (const member of this.members.values()) if (normaliseName(member.name) === wanted) return member;
    return undefined;
  }

  /** Name and away flag for each member, in seat order. */
  memberNames(): Array<{ name: string; away: boolean }> {
    return this.orderedMembers().map(({ name, connected }) => ({ name, away: !connected }));
  }

  /** Hands an away member to a new connection; the old token stops working. */
  takeOver(member: Member): void {
    member.token = randomBytes(24).toString('base64url');
    this.rejoin(member);
  }

  markAway(userId: string): void {
    const member = this.members.get(userId);
    if (!member) return;
    member.connected = false;
    if (this.hostId !== userId) return;
    let next: Member | undefined;
    for (const candidate of this.members.values()) {
      if (candidate.connected && (!next || candidate.seq < next.seq)) next = candidate;
    }
    this.hostId = next?.id ?? null;
  }

  rejoin(member: Member): void {
    member.connected = true;
    if (member.id === this.originalHostId || this.hostId === null) this.hostId = member.id;
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
      active.revision = (active.revision ?? 0) + 1;
      delete active.agreedEstimate;
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
    if (ticket.jira) return 'Imported Jira details are read-only';
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

  importTicket(userId: string, ticket: Ticket & { jira: JiraLink; descriptionAdf: AdfDocument }): RoomTicket {
    if (this.tickets.some((existing) => existing.jira?.cloudId === ticket.jira.cloudId &&
        existing.jira.issueId === ticket.jira.issueId)) throw new Error('This Jira issue is already in the room');
    const error = this.addTicket(userId, ticket);
    if (error) throw new Error(error);
    return this.tickets[this.tickets.length - 1];
  }

  agreeEstimate(userId: string, ticketId: string, points: number): string | null {
    if (userId !== this.hostId) return 'Only the host can agree an estimate';
    const ticket = this.tickets.find((existing) => existing.id === ticketId);
    if (!ticket?.jira || ticket.type === 'spike' || !ticket.result ||
        ticketId !== this.activeTicketId || !this.revealed) return 'Reveal a linked story before agreeing points';
    if (!(STORY_POINT_VALUES as readonly number[]).includes(points)) return 'Choose a numeric value from the story deck';
    ticket.agreedEstimate = points;
    ticket.revision = (ticket.revision ?? 0) + 1;
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
      users: members.map(({ id, name, avatar, vote, spectating, connected }) => ({
        id,
        name,
        ...(avatar ? { avatar } : {}),
        hasVoted: vote !== undefined,
        spectating,
        away: !connected,
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
    const active = this.tickets.find((ticket) => ticket.id === this.activeTicketId);
    if (active) {
      delete active.agreedEstimate;
      active.revision = (active.revision ?? 0) + 1;
    }
    for (const member of this.members.values()) delete member.vote;
  }
}
