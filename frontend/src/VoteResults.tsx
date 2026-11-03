import { useId } from 'react';
import { deckFor, voteLabel } from './config';
import type { RosterUser, TicketType } from './types';

interface VoteResultsProps {
  users: Array<Pick<RosterUser, 'id' | 'name'>>;
  votes: Record<string, string>;
  ticketType?: TicketType;
  title?: string;
}

export function VoteResults({ users, votes, ticketType = 'story', title = 'Vote results' }: VoteResultsProps) {
  const headingId = useId();
  const deckOrder = new Map<string, number>(deckFor(ticketType).map((value, index) => [value, index]));
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
  const takenLabels = new Set(users.map(({ name }) => name).filter((name) => nameCounts.get(name) === 1));
  const nextSuffix = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const { id, name } of users) {
    if (nameCounts.get(name) === 1) {
      labels.set(id, name);
      continue;
    }
    let suffix = nextSuffix.get(name) ?? 1;
    while (takenLabels.has(`${name} (${suffix})`)) suffix += 1;
    const label = `${name} (${suffix})`;
    takenLabels.add(label);
    nextSuffix.set(name, suffix + 1);
    labels.set(id, label);
  }

  return (
    <section className="card vote-results" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <div className="vote-results-layout">
        <div>
          <h3>Frequency</h3>
          {frequencies.length === 0 ? (
            <p className="hint" role="status">No votes to graph yet.</p>
          ) : (
            <ol className="vote-results-bars" aria-label="Vote frequency">
              {frequencies.map(({ value, count }) => (
                <li key={value} className="vote-result-row">
                  <span className="vote-result-value">{voteLabel(value, ticketType)}</span>
                  <div
                    className="vote-result-track"
                    role="meter"
                    aria-label={`${voteLabel(value, ticketType)}: ${count} ${count === 1 ? 'vote' : 'votes'}`}
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
            {users.map((user) => (
              <li key={user.id}>
                <span>{labels.get(user.id)}</span>
                <strong>{votes[user.id] !== undefined ? voteLabel(votes[user.id], ticketType) : 'No vote'}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}