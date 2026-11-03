import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { RoomTicket, TicketType } from './types';
import { MAX_TICKETS, ticketError } from './validation';
import { VoteResults } from './VoteResults';

const TYPE_LABELS: Record<TicketType, string> = { story: 'Story', spike: 'Spike' };

interface TicketPanelProps {
  tickets: RoomTicket[];
  activeTicketId: string | null;
  isHost: boolean;
  onAdd: (content: string, type: TicketType) => void;
  onEdit: (ticketId: string, content: string, type: TicketType) => void;
  onRemove: (ticketId: string) => void;
  onSelect: (ticketId: string) => void;
}

function TicketTypeOptions({ value, onChange }: { value: TicketType; onChange: (type: TicketType) => void }) {
  const name = useId();
  return (
    <fieldset className="field">
      <legend>Ticket type</legend>
      <div className="type-options">
        {(['story', 'spike'] as const).map((type) => (
          <label key={type}>
            <input type="radio" name={name} value={type} checked={value === type} onChange={() => onChange(type)} />{' '}
            {TYPE_LABELS[type]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface TicketTextFormProps {
  label: string;
  submitLabel: string;
  initial?: string;
  disabled?: boolean;
  onSubmit: (content: string) => void;
  children?: ReactNode;
}

function TicketTextForm({ label, submitLabel, initial = '', disabled, onSubmit, children }: TicketTextFormProps) {
  const [content, setContent] = useState(initial);
  const [touched, setTouched] = useState(false);
  const contentId = useId();
  const errorId = useId();

  const error = ticketError(content);
  const showError = touched && error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (error || disabled) return;
    onSubmit(content.trim());
  };

  return (
    <form className="ticket-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={contentId}>{label}</label>
        <textarea
          id={contentId}
          rows={3}
          value={content}
          aria-invalid={showError ? true : undefined}
          aria-describedby={showError ? errorId : undefined}
          onChange={(event) => {
            setContent(event.target.value);
            setTouched(true);
          }}
          onBlur={() => setTouched(true)}
        />
        {showError && (
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="vote-actions">
        <button type="submit" className="primary" disabled={!!error || disabled}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

function AddTicketForm({ tickets, onAdd }: { tickets: RoomTicket[]; onAdd: TicketPanelProps['onAdd'] }) {
  const [type, setType] = useState<TicketType>('story');
  const [pending, setPending] = useState<{ content: string; knownIds: Set<string> } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const full = tickets.length >= MAX_TICKETS;

  // Clear the draft only once the server broadcasts the new ticket, so a rejection keeps it.
  useEffect(() => {
    if (!pending) return;
    if (tickets.some((ticket) => !pending.knownIds.has(ticket.id) && ticket.content === pending.content)) {
      setPending(null);
      setFormKey((key) => key + 1);
    }
  }, [tickets, pending]);

  const add = (content: string) => {
    setPending({ content, knownIds: new Set(tickets.map((ticket) => ticket.id)) });
    onAdd(content, type);
  };

  return (
    <div className="ticket-add">
      <TicketTypeOptions value={type} onChange={setType} />
      <TicketTextForm
        key={formKey}
        label="What are we estimating?"
        submitLabel="Add ticket"
        disabled={full}
        onSubmit={add}
      />
      {full && (
        <p className="hint" role="status">
          You've reached the limit of {MAX_TICKETS} tickets. Remove one to add another.
        </p>
      )}
    </div>
  );
}

interface TicketItemProps extends Omit<TicketPanelProps, 'tickets' | 'activeTicketId' | 'onAdd'> {
  ticket: RoomTicket;
  active: boolean;
}

function TicketItem({ ticket, active, isHost, onEdit, onRemove, onSelect }: TicketItemProps) {
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState<TicketType>(ticket.type);
  const [pendingEdit, setPendingEdit] = useState<{ content: string; type: TicketType } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const resultsId = useId();

  // Close the editor only once the server broadcasts the saved edit, so a rejection keeps the draft.
  useEffect(() => {
    if (pendingEdit !== null && ticket.content === pendingEdit.content && ticket.type === pendingEdit.type) {
      setPendingEdit(null);
      setEditing(false);
    }
  }, [ticket.content, ticket.type, pendingEdit]);

  const startEditing = () => {
    setEditType(ticket.type);
    setEditing(true);
  };

  const stopEditing = () => {
    setPendingEdit(null);
    setEditing(false);
  };

  const remove = () => {
    if (window.confirm(`Remove this ticket?\n\n${ticket.content}`)) onRemove(ticket.id);
  };

  return (
    <li className={active ? 'ticket-item active' : 'ticket-item'} aria-current={active ? 'true' : undefined}>
      <div className="ticket-badges">
        <span className="badge">{TYPE_LABELS[ticket.type]}</span>
        {active && <span className="badge voted">Active</span>}
        {ticket.result && <span className="badge waiting">Revealed</span>}
      </div>
      {editing ? (
        <>
          <TicketTypeOptions value={editType} onChange={setEditType} />
          {editType !== ticket.type && (
            <p className="hint" role="status">
              Changing the type clears this ticket's votes and results.
            </p>
          )}
          <TicketTextForm
            label="Edit ticket text"
            submitLabel="Save"
            initial={ticket.content}
            onSubmit={(content) => {
              setPendingEdit({ content, type: editType });
              onEdit(ticket.id, content, editType);
            }}
          >
            <button type="button" onClick={stopEditing}>
              Cancel
            </button>
          </TicketTextForm>
        </>
      ) : (
        <p className="ticket-content">{ticket.content}</p>
      )}
      <div className="vote-actions">
        {isHost && !active && (
          <button type="button" className="primary" onClick={() => onSelect(ticket.id)}>
            Start voting
          </button>
        )}
        {isHost && !editing && (
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
  const active = tickets.find((ticket) => ticket.id === activeTicketId);

  return (
    <section className="card" aria-labelledby="ticket-heading">
      <h2 id="ticket-heading">
        Tickets ({tickets.length}/{MAX_TICKETS})
      </h2>
      {active ? (
        <p className="ticket-content">
          <strong>Now voting:</strong> {active.content}
        </p>
      ) : tickets.length === 0 ? (
        !isHost && <p className="hint">Waiting for the host to add a ticket.</p>
      ) : (
        <p className="hint">
          {isHost ? 'No ticket is active. Choose one to start voting.' : 'Waiting for the host to choose a ticket.'}
        </p>
      )}
      {tickets.length > 0 && (
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
      )}
      {isHost && <AddTicketForm tickets={tickets} onAdd={onAdd} />}
    </section>
  );
}
