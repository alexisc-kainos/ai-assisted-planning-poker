import { Mascot } from './Mascot';
import { JiraDescription, JiraIssueLink } from './JiraDescription';
import { TYPE_LABELS } from './TicketPanel';
import type { RoomTicket } from './types';

interface CurrentTicketProps {
  tickets: RoomTicket[];
  activeTicketId: string | null;
  isHost: boolean;
}

export function CurrentTicket({ tickets, activeTicketId, isHost }: CurrentTicketProps) {
  const active = tickets.find((ticket) => ticket.id === activeTicketId);

  if (active) {
    return (
      <section className="current-ticket" aria-label="Current ticket">
        <span className="badge">{TYPE_LABELS[active.type]}</span>
        <p className="now-voting">
          <strong>Now voting:</strong> {active.title}
        </p>
        {active.jira && <JiraIssueLink url={active.jira.url}>{active.jira.key}</JiraIssueLink>}
        {active.jira && active.descriptionAdf ? (
          <JiraDescription document={active.descriptionAdf} issueUrl={active.jira.url} />
        ) : active.description && <p className="now-voting-description">{active.description}</p>}
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
