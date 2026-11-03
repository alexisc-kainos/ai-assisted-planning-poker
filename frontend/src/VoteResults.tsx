import { STORY_DECK } from './config';
import type { RosterUser } from './types';

interface VoteResultsProps {
  users: RosterUser[];
  votes: Record<string, string>;
}

export function VoteResults({ users, votes }: VoteResultsProps) {
  const deckOrder = new Map<string, number>(STORY_DECK.map((value, index) => [value, index]));
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();

  Object.values(votes).forEach((value, index) => {
    if (!counts.has(value)) firstSeen.set(value, index);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  const frequencies = [...counts].map(([value, count]) => ({ value, count, firstSeen: firstSeen.get(value) ?? 0 }));
  frequencies.sort((left, right) => {
    if (left.count !== right.count) return right.count - left.count;
    const leftDeckOrder = deckOrder.get(left.value);
    const rightDeckOrder = deckOrder.get(right.value);
    if (leftDeckOrder !== undefined || rightDeckOrder !== undefined) {
      if (leftDeckOrder === undefined) return 1;
      if (rightDeckOrder === undefined) return -1;
      if (leftDeckOrder !== rightDeckOrder) return leftDeckOrder - rightDeckOrder;
    }
    return left.firstSeen - right.firstSeen;
  });

  const maximumCount = frequencies[0]?.count ?? 1;
  const nameCounts = new Map<string, number>();
  users.forEach(({ name }) => nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1));
  const nameIndexes = new Map<string, number>();

  return (
    <section className="card vote-results" aria-labelledby="results-heading">
      <h2 id="results-heading">Vote results</h2>
      <div className="vote-results-layout">
        <div>
          <h3>Frequency</h3>
          {frequencies.length === 0 ? (
            <p className="hint" role="status">No votes to graph yet.</p>
          ) : (
            <ol className="vote-results-bars" aria-label="Vote frequency">
              {frequencies.map(({ value, count }) => (
                <li key={value} className="vote-result-row">
                  <span className="vote-result-value">{value}</span>
                  <div
                    className="vote-result-track"
                    role="meter"
                    aria-label={`${value}: ${count} ${count === 1 ? 'vote' : 'votes'}`}
                    aria-valuemin={0}
                    aria-valuemax={maximumCount}
                    aria-valuenow={count}
                  >
                    <span className="vote-result-bar" style={{ width: `${(count / maximumCount) * 100}%` }} />
                  </div>
                  <strong aria-hidden="true">{count}</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h3>Participants</h3>
          <ul className="participant-votes" aria-label="Participant votes">
            {users.map((user) => {
              const duplicateIndex = nameIndexes.get(user.name) ?? 0;
              nameIndexes.set(user.name, duplicateIndex + 1);
              const name = nameCounts.get(user.name)! > 1 ? `${user.name} (${duplicateIndex + 1})` : user.name;

              return (
                <li key={user.id}>
                  <span>{name}</span>
                  <strong>{votes[user.id] ?? 'No vote'}</strong>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}