import { useId, useState, type FormEvent } from 'react';
import type { Ticket } from './types';
import { ticketError } from './validation';

interface TicketPanelProps {
  ticket: Ticket | null;
  isHost: boolean;
  onSetTicket: (content: string) => void;
}

function TicketEditor({ ticket, onSetTicket }: Omit<TicketPanelProps, 'isHost'>) {
  const [content, setContent] = useState(ticket?.content ?? '');
  const [touched, setTouched] = useState(false);
  const contentId = useId();
  const errorId = useId();

  const error = ticketError(content);
  const showError = touched && error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!error) onSetTicket(content.trim());
  };

  return (
    <form className="ticket-form" onSubmit={submit} noValidate>
      <fieldset className="field">
        <legend>Ticket type</legend>
        <div className="type-options">
          <label>
            <input type="radio" name="ticket-type" value="story" checked readOnly /> Story
          </label>
          <label className="disabled">
            <input type="radio" name="ticket-type" value="spike" disabled /> Spike
          </label>
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={contentId}>What are we estimating?</label>
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
      <button type="submit" className="primary" disabled={!!error}>
        {ticket ? 'Update ticket' : 'Set ticket'}
      </button>
    </form>
  );
}

export function TicketPanel({ ticket, isHost, onSetTicket }: TicketPanelProps) {
  return (
    <section className="card" aria-labelledby="ticket-heading">
      <h2 id="ticket-heading">Ticket</h2>
      {isHost ? (
        <TicketEditor ticket={ticket} onSetTicket={onSetTicket} />
      ) : ticket ? (
        <>
          <span className="badge">Story</span>
          <p className="ticket-content">{ticket.content}</p>
        </>
      ) : (
        <p className="hint">Waiting for the host to add a ticket.</p>
      )}
    </section>
  );
}
