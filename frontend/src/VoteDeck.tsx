import { useLayoutEffect, useRef } from 'react';
import { COFFEE_CARD, deckFor, voteLabel } from './config';
import type { TicketType } from './types';

interface VoteDeckProps {
  selected: string | null;
  ticketType?: TicketType;
  disabled?: boolean;
  round: number;
  ticketId: string;
  onVote: (value: string) => void;
}

export function VoteDeck({ selected, ticketType = 'story', disabled = false, round, ticketId, onVote }: VoteDeckProps) {
  const previous = useRef({ round, ticketId });
  const deck = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const reset = previous.current.ticketId === ticketId && previous.current.round !== round;
    previous.current = { round, ticketId };
    if (!reset || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !deck.current) return;

    const cards = Array.from(deck.current.querySelectorAll<HTMLElement>('.deck-card'));
    if (cards.length === 0) return;
    const positions = cards.map((card) => card.getBoundingClientRect());
    const centerX = (Math.min(...positions.map((rect) => rect.left)) + Math.max(...positions.map((rect) => rect.right))) / 2;
    const centerY = (Math.min(...positions.map((rect) => rect.top)) + Math.max(...positions.map((rect) => rect.bottom))) / 2;
    const animations = cards.map((card, index) => {
      const rect = positions[index];
      const x = centerX - (rect.left + rect.width / 2);
      const y = centerY - (rect.top + rect.height / 2);
      const angle = (index - (cards.length - 1) / 2) * 4;
      return card.animate([
        { transform: 'translate(0, 0) rotate(0deg)', offset: 0 },
        { transform: `translate(${x}px, ${y}px) rotate(0deg)`, offset: 0.4 },
        { transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`, offset: 0.6 },
        { transform: 'translate(0, 0) rotate(0deg)', offset: 1 },
      ], { duration: 1100, easing: 'ease-in-out' });
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [round, ticketId]);

  const spike = ticketType === 'spike';
  return (
    <section className="card vote-deck" aria-labelledby="deck-heading">
      <h2 id="deck-heading">{spike ? 'Your vote (days)' : 'Your vote'}</h2>
      <div ref={deck} className="deck" role="group" aria-labelledby="deck-heading">
        {deckFor(ticketType).map((value) => (
          <span key={value} className="deck-card">
            <button
              type="button"
              className="vote-card"
              aria-pressed={selected === value}
              aria-label={value === COFFEE_CARD ? 'Coffee break' : spike ? voteLabel(value, ticketType) : undefined}
              disabled={disabled}
              onClick={() => onVote(value)}
            >
              {value === COFFEE_CARD ? (
                <span className="coffee-cup">
                  {value}
                  {selected === value && <span className="coffee-steam" aria-hidden="true" />}
                </span>
              ) : value}
              {spike && value !== COFFEE_CARD && (
                <span className="vote-card-unit" aria-hidden="true">
                  {value === '1' ? 'day' : 'days'}
                </span>
              )}
            </button>
          </span>
        ))}
      </div>
      <p className="hint">Votes stay hidden until the host reveals them. You can change yours at any time.</p>
    </section>
  );
}
