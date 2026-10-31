import { COFFEE_CARD, STORY_DECK } from './config';

interface VoteDeckProps {
  selected: string | null;
  disabled?: boolean;
  onVote: (value: string) => void;
}

export function VoteDeck({ selected, disabled = false, onVote }: VoteDeckProps) {
  return (
    <section className="card" aria-labelledby="deck-heading">
      <h2 id="deck-heading">Your vote</h2>
      <div className="deck" role="group" aria-labelledby="deck-heading">
        {STORY_DECK.map((value) => (
          <button
            key={value}
            type="button"
            className="vote-card"
            aria-pressed={selected === value}
            aria-label={value === COFFEE_CARD ? 'Coffee break' : undefined}
            disabled={disabled}
            onClick={() => onVote(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="hint">Votes stay hidden until the host reveals them. You can change yours at any time.</p>
    </section>
  );
}
