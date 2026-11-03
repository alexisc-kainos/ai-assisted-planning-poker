import { useState } from 'react';
import { CurrentTicket } from './CurrentTicket';
import { JoinForm } from './JoinForm';
import { Mascot } from './Mascot';
import { Roster } from './Roster';
import { TicketPanel } from './TicketPanel';
import { VoteDeck } from './VoteDeck';
import { VoteResults } from './VoteResults';
import { joinUrl } from './room';
import { useRoom } from './useRoom';

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="share" aria-label="Share this room">
      <label htmlFor="join-url">Invite your team with this link</label>
      <div className="share-row">
        <input id="join-url" type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
    </section>
  );
}

export function RoomPage({ roomId }: { roomId: string }) {
  const {
    status,
    error,
    capacity,
    userId,
    state,
    join,
    vote,
    reveal,
    reset,
    addTicket,
    editTicket,
    removeTicket,
    selectTicket,
    setSpectating,
  } = useRoom(roomId);
  const url = joinUrl(roomId);

  if (status === 'joined' && state) {
    const ticketType = state.tickets.find((ticket) => ticket.id === state.activeTicketId)?.type ?? 'story';
    const spectating = state.users.find((user) => user.id === userId)?.spectating ?? false;
    const votes = state.votes ?? {};
    const isHost = state.hostId === userId;
    return (
      <div className="room-layout">
        <div className="room-main">
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <CurrentTicket tickets={state.tickets} activeTicketId={state.activeTicketId} isHost={isHost} />
          {state.revealed && (
            <VoteResults
              users={state.users.filter((user) => !user.spectating || votes[user.id] !== undefined)}
              votes={votes}
              ticketType={ticketType}
            />
          )}
          {!spectating && (
            <VoteDeck
              selected={state.myVote}
              ticketType={ticketType}
              disabled={state.revealed}
              onVote={(value) => vote(value, state.round)}
            />
          )}
          {isHost && (
            <section className="card" aria-labelledby="voting-controls-heading">
              <h2 id="voting-controls-heading">Voting controls</h2>
              <div className="vote-actions">
                <button type="button" className="primary" onClick={reveal}>Reveal votes</button>
                <button type="button" onClick={reset}>Reset votes</button>
              </div>
            </section>
          )}
        </div>
        <aside className="room-side" aria-label="Room">
          <CopyLink url={url} />
          <section className="participation" aria-label="Participation">
            <label className="spectate-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={spectating}
                onChange={(e) => setSpectating(e.currentTarget.checked)}
              />
              Spectate
            </label>
            {spectating && <p className="hint">You're spectating — switch off to vote.</p>}
          </section>
          <Roster users={state.users} hostId={state.hostId} meId={userId} />
        </aside>
        <div className="room-tickets">
          <TicketPanel
            tickets={state.tickets}
            activeTicketId={state.activeTicketId}
            isHost={isHost}
            onAdd={addTicket}
            onEdit={editTicket}
            onRemove={removeTicket}
            onSelect={selectTicket}
          />
        </div>
        {state.activeTicketId !== null && <Mascot className="mascot room-mascot" />}
      </div>
    );
  }

  const busy = status === 'checking' || status === 'connecting' || status === 'reconnecting';

  return (
    <div className="narrow">
      <h2 className="room-title">
        Joining room <code>{roomId}</code>
      </h2>
      {status === 'full' && (
        <p className="notice error" role="alert">
          This room is full ({capacity}/{capacity}) — you can't join right now.
        </p>
      )}
      {status === 'error' && error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="notice" role="status">
          {status === 'reconnecting' ? 'Reconnecting…' : 'Connecting… the server may take up to a minute to wake up.'}
        </p>
      )}
      <JoinForm onJoin={join} busy={busy} />
    </div>
  );
}
