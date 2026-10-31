import { Avatar } from './avatars';
import type { RosterUser } from './types';

interface RosterProps {
  users: RosterUser[];
  hostId: string | null;
  meId: string | null;
}

export function Roster({ users, hostId, meId }: RosterProps) {
  return (
    <section className="card" aria-labelledby="roster-heading">
      <h2 id="roster-heading">In the room ({users.length})</h2>
      <ul className="roster">
        {users.map((user) => (
          <li key={user.id} className="roster-item">
            <Avatar id={user.avatar} size={44} />
            <span className="roster-name">
              {user.name}
              {user.id === meId && <span className="you"> (you)</span>}
            </span>
            <span className="roster-badges">
              {user.id === hostId && <span className="badge">Host</span>}
              {user.hasVoted ? (
                <span className="badge voted">✓ Voted</span>
              ) : (
                <span className="badge waiting">Waiting</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
