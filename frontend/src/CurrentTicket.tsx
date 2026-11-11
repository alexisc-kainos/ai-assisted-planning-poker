import { Mascot } from './Mascot';
import { JiraIssueLink } from './JiraDescription';
import { ExpandTicketButton, TYPE_LABELS } from './TicketPanel';
import type { RoomTicket } from './types';

interface CurrentTicketProps {
  tickets: RoomTicket[];
  activeTicketId: string | null;
  isHost: boolean;
  onExpand: (ticketId: string) => void;
}

export function CurrentTicket({ tickets, activeTicketId, isHost, onExpand }: CurrentTicketProps) {
  const active = tickets.find((ticket) => ticket.id === activeTicketId);

  if (active) {
    return (
      <section className="current-ticket" aria-label="Current ticket">
        <div className="ticket-badges">
          <span className="badge">{TYPE_LABELS[active.type]}</span>
          <ExpandTicketButton onExpand={() => onExpand(active.id)} />
        </div>
        <p className="now-voting">
          <strong>Now voting:</strong> {active.title}
        </p>
        {active.jira && <JiraIssueLink url={active.jira.url}>{active.jira.key}</JiraIssueLink>}
      </section>
    );
  }

  const hint =
    tickets.length === 0
      ? !isHost && 'Waiting for the host to add a ticket.'
      : isHost
        ? 'No ticket is active. Choose one to start voting.'
        : 'Waiting for the host to choose a ticket.';

  return (
    <section className="card room-hero" aria-labelledby="room-hero-heading">
      <div>
        <p className="eyebrow">Room ready</p>
        <h2 id="room-hero-heading">The room is ready</h2>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <Mascot />
    </section>
  );
}
