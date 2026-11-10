import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { RoomTicket, TicketFields, TicketType } from './types';
import { MAX_TICKETS, ticketDescriptionError, ticketTitleError } from './validation';
import { VoteResults } from './VoteResults';
import { JiraDescription, JiraIssueLink } from './JiraDescription';

export const TYPE_LABELS: Record<TicketType, string> = { story: 'Story', spike: 'Spike', bug: 'Bug', task: 'Task' };

interface TicketPanelProps {
  tickets: RoomTicket[];
  activeTicketId: string | null;
  isHost: boolean;
  onAdd: (fields: TicketFields, type: TicketType) => void;
  onEdit: (ticketId: string, fields: TicketFields, type: TicketType) => void;
  onRemove: (ticketId: string) => void;
  onSelect: (ticketId: string) => void;
}

function TicketTypeOptions({ value, onChange }: { value: TicketType; onChange: (type: TicketType) => void }) {
  const name = useId();
  return (
    <fieldset className="field">
      <legend>Ticket type</legend>
      <div className="type-options">
        {(['story', 'spike', 'bug', 'task'] as const).map((type) => (
          <label key={type}>
            <input type="radio" name={name} value={type} checked={value === type} onChange={() => onChange(type)} />{' '}
            {TYPE_LABELS[type]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface TicketFieldsFormProps {
  labels: { title: string; description: string };
  submitLabel: string;
  initial?: TicketFields;
  disabled?: boolean;
  onSubmit: (fields: TicketFields) => void;
  children?: ReactNode;
}

function TicketFieldsForm({ labels, submitLabel, initial, disabled, onSubmit, children }: TicketFieldsFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [touched, setTouched] = useState(false);
  const titleId = useId();
  const titleErrorId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();

  const titleError = ticketTitleError(title);
  const descriptionError = ticketDescriptionError(description);
  const showTitleError = touched && titleError;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (titleError || descriptionError || disabled) return;
    onSubmit({ title: title.trim(), description: description.trim() });
  };

  return (
    <form className="ticket-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={titleId}>{labels.title}</label>
        <input
          id={titleId}
          type="text"
          value={title}
          aria-invalid={showTitleError ? true : undefined}
          aria-describedby={showTitleError ? titleErrorId : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            setTouched(true);
          }}
          onBlur={() => setTouched(true)}
        />
        {showTitleError && (
          <p id={titleErrorId} className="field-error" role="alert">
            {titleError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={descriptionId}>{labels.description}</label>
        <textarea
          id={descriptionId}
          rows={3}
          value={description}
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={descriptionError ? descriptionErrorId : undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
        {descriptionError && (
          <p id={descriptionErrorId} className="field-error" role="alert">
            {descriptionError}
          </p>
        )}
      </div>
      <div className="vote-actions">
        <button type="submit" className="primary" disabled={!!titleError || !!descriptionError || disabled}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

const sameFields = (ticket: TicketFields, fields: TicketFields) =>
  ticket.title === fields.title && ticket.description === fields.description;

interface AddTicketFormProps {
  tickets: RoomTicket[];
  onAdd: (fields: TicketFields, type: TicketType) => void;
}

export function AddTicketForm({ tickets, onAdd }: AddTicketFormProps) {
  const [type, setType] = useState<TicketType>('story');
  const [pending, setPending] = useState<{ fields: TicketFields; knownIds: Set<string> } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const full = tickets.length >= MAX_TICKETS;

  // Clear the draft only once the server broadcasts the new ticket, so a rejection keeps it.
  useEffect(() => {
    if (!pending) return;
    if (tickets.some((ticket) => !pending.knownIds.has(ticket.id) && sameFields(ticket, pending.fields))) {
      setPending(null);
      setFormKey((key) => key + 1);
    }
  }, [tickets, pending]);

  const add = (fields: TicketFields) => {
    setPending({ fields, knownIds: new Set(tickets.map((ticket) => ticket.id)) });
    onAdd(fields, type);
  };

  return (
    <section className="card add-tickets" aria-labelledby="add-tickets-heading">
      <h2 id="add-tickets-heading">Add tickets</h2>
      <TicketTypeOptions value={type} onChange={setType} />
      <TicketFieldsForm
        key={formKey}
        labels={{ title: 'Ticket title', description: 'Ticket description (optional)' }}
        submitLabel="Add ticket"
        disabled={full}
        onSubmit={add}
      />
      {full && (
        <p className="hint" role="status">
          You've reached the limit of {MAX_TICKETS} tickets. Remove one to add another.
        </p>
      )}
    </section>
  );
}

interface TicketItemProps extends Omit<TicketPanelProps, 'tickets' | 'activeTicketId' | 'onAdd'> {
  ticket: RoomTicket;
  active: boolean;
}

function TicketItem({ ticket, active, isHost, onEdit, onRemove, onSelect }: TicketItemProps) {
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState<TicketType>(ticket.type);
  const [pendingEdit, setPendingEdit] = useState<(TicketFields & { type: TicketType }) | null>(null);
  const [showResults, setShowResults] = useState(false);
  const resultsId = useId();

  // Close the editor only once the server broadcasts the saved edit, so a rejection keeps the draft.
  useEffect(() => {
    if (pendingEdit !== null && sameFields(ticket, pendingEdit) && ticket.type === pendingEdit.type) {
      setPendingEdit(null);
      setEditing(false);
    }
  }, [ticket, pendingEdit]);

  const startEditing = () => {
    setEditType(ticket.type);
    setEditing(true);
  };

  const stopEditing = () => {
    setPendingEdit(null);
    setEditing(false);
  };

  const remove = () => {
    if (window.confirm(`Remove this ticket?\n\n${ticket.title}`)) onRemove(ticket.id);
  };

  return (
    <li className={active ? 'ticket-item active' : 'ticket-item'} aria-current={active ? 'true' : undefined}>
      <div className="ticket-badges">
        <span className={`badge type-${ticket.type}`}>{TYPE_LABELS[ticket.type]}</span>
        {active && <span className="badge voted">Active</span>}
        {ticket.result && <span className="badge waiting">Revealed</span>}
      </div>
      {editing && !ticket.jira ? (
        <>
          <TicketTypeOptions value={editType} onChange={setEditType} />
          {editType !== ticket.type && (
            <p className="hint" role="status">
              Changing the type clears this ticket's votes and results.
            </p>
          )}
          <TicketFieldsForm
            labels={{ title: 'Edit title', description: 'Edit description (optional)' }}
            submitLabel="Save"
            initial={ticket}
            onSubmit={(fields) => {
              setPendingEdit({ ...fields, type: editType });
              onEdit(ticket.id, fields, editType);
            }}
          >
            <button type="button" onClick={stopEditing}>
              Cancel
            </button>
          </TicketFieldsForm>
        </>
      ) : (
        <div className="ticket-content">
          <p className="ticket-title">
            <strong>{ticket.title}</strong>
          </p>
          {ticket.jira && <JiraIssueLink url={ticket.jira.url}>{ticket.jira.key}</JiraIssueLink>}
          {ticket.jira && ticket.descriptionAdf ? (
            <JiraDescription document={ticket.descriptionAdf} issueUrl={ticket.jira.url} />
          ) : ticket.description && <p className="ticket-description">{ticket.description}</p>}
        </div>
      )}
      <div className="vote-actions">
        {isHost && !active && (
          <button type="button" className="accent" onClick={() => onSelect(ticket.id)}>
            Start voting
          </button>
        )}
        {isHost && !editing && !ticket.jira && (
          <button type="button" onClick={startEditing}>
            Edit
          </button>
        )}
        {isHost && (
          <button type="button" onClick={remove}>
            Remove
          </button>
        )}
        {ticket.result && (
          <button
            type="button"
            aria-expanded={showResults}
            aria-controls={resultsId}
            onClick={() => setShowResults((shown) => !shown)}
          >
            {showResults ? 'Hide results' : 'Show results'}
          </button>
        )}
      </div>
      {ticket.result && showResults && (
        <div id={resultsId}>
          <VoteResults
            users={ticket.result.users}
            votes={ticket.result.votes}
            ticketType={ticket.type}
            title="Previous results"
          />
        </div>
      )}
    </li>
  );
}

export function TicketPanel({ tickets, activeTicketId, isHost, onAdd, ...itemProps }: TicketPanelProps) {
  return (
    <section className="card tickets-card" aria-labelledby="ticket-heading">
      <h2 id="ticket-heading">Tickets</h2>
      {tickets.length > 0 ? (
        <ol className="ticket-list" aria-label="Tickets">
          {tickets.map((ticket) => (
            <TicketItem
              key={ticket.id}
              ticket={ticket}
              active={ticket.id === activeTicketId}
              isHost={isHost}
              {...itemProps}
            />
          ))}
        </ol>
      ) : (
        <p className="hint">No tickets added yet</p>
      )}
      {isHost && <AddTicketForm tickets={tickets} onAdd={onAdd} />}
    </section>
  );
}
