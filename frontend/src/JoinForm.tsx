import { useId, useState, type FormEvent } from 'react';
import { AVATARS, Avatar } from './avatars';
import type { RoomMemberName } from './types';
import { findMember, nameError } from './validation';

interface JoinFormProps {
  onJoin: (name: string, avatar: string) => void;
  onTakeover?: (name: string) => void;
  members?: readonly RoomMemberName[];
  busy?: boolean;
}

export function JoinForm({ onJoin, onTakeover, members = [], busy = false }: JoinFormProps) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const nameId = useId();
  const errorId = useId();

  const holder = findMember(members, name);
  const error =
    nameError(name) ??
    (holder && !holder.away
      ? `Someone in this room is already called ${holder.name}. Please choose a different name.`
      : null);
  const awayHolder = holder?.away ? holder : undefined;
  const showError = touched && error;
  const canJoin = !error && !awayHolder && avatar !== null && !busy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (canJoin && avatar) onJoin(name.trim(), avatar);
  };

  return (
    <form className="card join-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={nameId}>Your name</label>
        <input
          id={nameId}
          type="text"
          value={name}
          autoComplete="nickname"
          aria-invalid={showError ? true : undefined}
          aria-describedby={showError || awayHolder ? errorId : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setTouched(true);
          }}
          onBlur={() => setTouched(true)}
        />
        {showError && (
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
        {awayHolder && (
          <div className="takeover">
            <p id={errorId} role="status">
              {awayHolder.name} is away in this room. Is that you?
            </p>
            <button type="button" disabled={busy} onClick={() => onTakeover?.(awayHolder.name)}>
              Rejoin as {awayHolder.name}
            </button>
          </div>
        )}
      </div>

      <fieldset className="field">
        <legend>Choose your avatar</legend>
        <div className="avatar-grid">
          {AVATARS.map((option) => (
            <label key={option.id} className={`avatar-option${avatar === option.id ? ' selected' : ''}`}>
              <input
                type="radio"
                name="avatar"
                value={option.id}
                checked={avatar === option.id}
                onChange={() => setAvatar(option.id)}
                className="visually-hidden"
              />
              <Avatar id={option.id} size={56} />
              <span className="visually-hidden">{option.label}</span>
            </label>
          ))}
        </div>
        {avatar === null && <p className="hint">Pick an avatar to join.</p>}
      </fieldset>

      <button type="submit" className="primary" disabled={!canJoin}>
        Join room
      </button>
    </form>
  );
}
