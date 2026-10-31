import { useState } from 'react';
import { JoinForm } from './JoinForm';
import { Roster } from './Roster';
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
    <section className="card share" aria-label="Share this room">
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
  const { status, error, capacity, userId, state, join } = useRoom(roomId);
  const url = joinUrl(roomId);

  if (status === 'joined' && state) {
    return (
      <>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <CopyLink url={url} />
        <Roster users={state.users} hostId={state.hostId} meId={userId} />
      </>
    );
  }

  const busy = status === 'checking' || status === 'connecting' || status === 'reconnecting';

  return (
    <>
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
    </>
  );
}
