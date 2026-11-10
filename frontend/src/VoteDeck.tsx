import { COFFEE_CARD, deckFor, voteLabel } from './config';
import type { TicketType } from './types';

interface VoteDeckProps {
  selected: string | null;
  ticketType?: TicketType;
  disabled?: boolean;
  onVote: (value: string) => void;
}

export function VoteDeck({ selected, ticketType = 'story', disabled = false, onVote }: VoteDeckProps) {
  const spike = ticketType === 'spike';
  return (
    <section className="card vote-deck" aria-labelledby="deck-heading">
      <h2 id="deck-heading">{spike ? 'Your vote (days)' : 'Your vote'}</h2>
      <div className="deck" role="group" aria-labelledby="deck-heading">
        {deckFor(ticketType).map((value) => (
          <button
            key={value}
            type="button"
            className="vote-card"
            aria-pressed={selected === value}
            aria-label={value === COFFEE_CARD ? 'Coffee break' : spike ? voteLabel(value, ticketType) : undefined}
            disabled={disabled}
            onClick={() => onVote(value)}
          >
            {value}
            {spike && value !== COFFEE_CARD && (
              <span className="vote-card-unit" aria-hidden="true">
                {value === '1' ? 'day' : 'days'}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="hint">Votes stay hidden until the host reveals them. You can change yours at any time.</p>
    </section>
  );
}
