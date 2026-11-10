import { useState } from 'react';
import { CurrentTicket } from './CurrentTicket';
import { JoinForm } from './JoinForm';
import { JiraPanel, type JiraEstimateFeedback } from './JiraPanel';
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
  const [jiraFeedbackByMember, setJiraFeedbackByMember] = useState<Record<string, JiraEstimateFeedback | null>>({});
  const {
    status,
    error,
    capacity,
    userId,
    state,
    members,
    join,
    takeOver,
    resume,
    vote,
    reveal,
    reset,
    addTicket,
    editTicket,
    removeTicket,
    selectTicket,
    setSpectating,
    jiraStatus,
    jiraRequest,
  } = useRoom(roomId);
  const url = joinUrl(roomId);
  const jiraFeedbackScope = JSON.stringify([roomId, userId]);
  const jiraEstimateFeedback = userId ? jiraFeedbackByMember[jiraFeedbackScope] ?? null : null;
  const updateJiraEstimateFeedback = (feedback: JiraEstimateFeedback | null) => {
    if (userId) setJiraFeedbackByMember((current) => ({ ...current, [jiraFeedbackScope]: feedback }));
  };

  if (status === 'joined' && state) {
    const activeTicketIndex = state.tickets.findIndex((ticket) => ticket.id === state.activeTicketId);
    const ticketType = state.tickets[activeTicketIndex]?.type ?? 'story';
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
          {!spectating && state.activeTicketId && (
            <VoteDeck
              selected={state.myVote}
              ticketType={ticketType}
              disabled={state.revealed}
              onVote={(value) => vote(value, state.round)}
            />
          )}
        </div>
        <aside className="room-side" aria-label="Room">
          <CopyLink url={url} />
          {isHost && <JiraPanel status={jiraStatus} state={state} request={jiraRequest}
            estimateFeedback={jiraEstimateFeedback} setEstimateFeedback={updateJiraEstimateFeedback} />}
          {isHost && (
            <section className="card" aria-labelledby="voting-controls-heading">
              <h2 id="voting-controls-heading">Voting controls</h2>
              <div className="vote-actions">
                <button type="button" className="accent" onClick={reveal}>Reveal votes</button>
                <button type="button" onClick={reset}>Reset votes</button>
              </div>
            </section>
          )}
          <Roster users={state.users} hostId={state.hostId} meId={userId} />
          <section className="card participation" aria-label="Participation">
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
        {activeTicketIndex >= 0 && <Mascot className="mascot room-mascot" ticketIndex={activeTicketIndex} />}
      </div>
    );
  }

  const restoring = status === 'rejoining' || status === 'reconnecting';
  const busy = status === 'checking' || status === 'connecting' || restoring;

  if (status === 'replaced') {
    return (
      <div className="narrow">
        <h2 className="room-title">
          Room <code>{roomId}</code>
        </h2>
        <section className="card replaced">
          <p role="alert">This room was opened in another tab or window.</p>
          <button type="button" className="primary" onClick={resume}>
            Use this tab instead
          </button>
        </section>
      </div>
    );
  }

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
          {restoring ? 'Reconnecting…' : 'Connecting… the server may take up to a minute to wake up.'}
        </p>
      )}
      {!restoring && <JoinForm onJoin={join} onTakeover={takeOver} members={members} busy={busy} />}
    </div>
  );
}
