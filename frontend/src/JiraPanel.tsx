import { useEffect, useId, useRef, useState } from 'react';
import { STORY_DECK } from './config';
import { JiraIssueLink, safeJiraUrl } from './JiraDescription';
import type { JiraField, JiraPreview, JiraRequest, JiraResult, JiraStatus, RoomState, RoomTicket } from './types';

type Request = (request: JiraRequest) => Promise<JiraResult>;
const numericDeck = STORY_DECK.filter((value) => Number.isFinite(Number(value)));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Jira request failed.';

function defaultPoints(ticket: RoomTicket): string {
  if (ticket.agreedEstimate !== undefined) return String(ticket.agreedEstimate);
  const counts = numericDeck.map((value) => ({ value,
    count: Object.values(ticket.result?.votes ?? {}).filter((vote) => vote === value).length }));
  const highest = Math.max(...counts.map(({ count }) => count));
  const leaders = counts.filter(({ count }) => count === highest);
  return highest > 0 && leaders.length === 1 ? leaders[0].value : '';
}

function Confirmation({ preview, onConfirm, onCancel, returnFocus }: {
  preview: JiraPreview;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocus: { current: HTMLButtonElement | null };
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, []);
  return (
    <div className="jira-dialog-backdrop">
      <div className="card jira-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="jira-confirm-heading"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
          if (event.key !== 'Tab') return;
          const controls = dialog.current?.querySelectorAll<HTMLElement>('a[href],button');
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
        <h2 id="jira-confirm-heading">Confirm Jira estimate</h2>
        <dl>
          <dt>Site</dt><dd>{preview.siteName}</dd>
          <dt>Issue</dt><dd><JiraIssueLink url={preview.issueUrl}>{preview.issueKey}</JiraIssueLink></dd>
          <dt>Field</dt><dd>{preview.fieldName} ({preview.fieldId})</dd>
          <dt>Current points</dt><dd>{preview.currentPoints ?? 'Not set'}</dd>
          <dt>New points</dt><dd>{preview.points}</dd>
        </dl>
        <div className="vote-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={onConfirm}>Confirm write to Jira</button>
        </div>
      </div>
    </div>
  );
}

function JiraEstimate({ ticket, request }: { ticket: RoomTicket; request: Request }) {
  const [points, setPoints] = useState(() => defaultPoints(ticket));
  const [fields, setFields] = useState<JiraField[]>([]);
  const [fieldId, setFieldId] = useState('');
  const [preview, setPreview] = useState<JiraPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const operation = useRef(0);
  const ownAgreement = useRef<{ revision: number; points: number } | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const expected = ownAgreement.current;
    if (expected && ticket.revision === expected.revision + 1 && ticket.agreedEstimate === expected.points) {
      ownAgreement.current = null;
      return;
    }
    operation.current += 1;
    ownAgreement.current = null;
    setPreview(null);
    setFields([]);
    setFieldId('');
    setBusy(false);
  }, [ticket.revision, ticket.agreedEstimate]);

  const update = async () => {
    if (!points || busy) return;
    const current = ++operation.current;
    setBusy(true);
    setPreview(null);
    try {
      if (Number(points) !== ticket.agreedEstimate) {
        ownAgreement.current = { revision: ticket.revision ?? 0, points: Number(points) };
        await request({ action: 'agree', ticketId: ticket.id, points: Number(points) });
        if (!live.current || operation.current !== current) return;
      }
      const result = await request({ action: 'prepare', ticketId: ticket.id, ...(fieldId ? { fieldId } : {}) });
      if (!live.current || operation.current !== current) return;
      if (result.fields) {
        setFields(result.fields);
        setFieldId('');
      } else if (result.preview) {
        setPreview(result.preview);
      }
    } catch {
      ownAgreement.current = null;
    } finally {
      if (live.current && operation.current === current) setBusy(false);
    }
  };

  const run = async (action: JiraRequest) => {
    setBusy(true);
    try {
      const result = await request(action);
      if (!live.current) return;
      if (result.fields) {
        setFields(result.fields);
        setFieldId('');
      } else if (result.preview) {
        setPreview(result.preview);
      }
    } catch {
      return;
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return (
    <div className="jira-estimate">
      <h3>Agreed estimate</h3>
      <p>Saved agreement: {ticket.agreedEstimate ?? 'Not set'}</p>
      <form className="ticket-form" onSubmit={(event) => {
        event.preventDefault();
        void update();
      }}>
        <div className="field">
          <label htmlFor="jira-points">Story points</label>
          <select id="jira-points" value={points} disabled={busy} onChange={(event) => {
            setPoints(event.target.value);
            setFields([]);
            setFieldId('');
            setPreview(null);
          }}>
            <option value="">Choose points</option>
            {numericDeck.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {fields.length > 0 && <div className="field">
          <label htmlFor="jira-field">Jira estimate field</label>
          <select id="jira-field" value={fieldId} disabled={busy} onChange={(event) => setFieldId(event.target.value)}>
            <option value="">Choose field</option>
            {fields.map((field) => <option key={field.id} value={field.id}>{field.name} ({field.id})</option>)}
          </select>
        </div>}
        <button ref={reviewButton} type="submit" disabled={busy || !points || (fields.length > 0 && !fieldId)}>Update Jira</button>
      </form>
      {preview && <Confirmation preview={preview} returnFocus={reviewButton} onCancel={() => setPreview(null)} onConfirm={() => {
        const confirmationId = preview.id;
        setPreview(null);
        void run({ action: 'confirm', confirmationId });
      }} />}
    </div>
  );
}

function JiraImportInput({ input, onChange, busy, request }: {
  input: string;
  onChange: (value: string) => void;
  busy: boolean;
  request: Request;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<NonNullable<JiraResult['suggestions']>>([]);
  const [active, setActive] = useState(-1);
  const [enabled, setEnabled] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const query = input.trim().toUpperCase();

  const dismiss = () => {
    generation.current += 1;
    setEnabled(false);
    setSuggestions([]);
    setActive(-1);
    setNotice('');
  };
  useEffect(() => {
    const current = ++generation.current;
    setSuggestions([]);
    setActive(-1);
    setNotice('');
    if (!enabled || busy || query.length > 64 || !/^[A-Z][A-Z0-9_]*-\d*$/i.test(query)) return;
    let disposed = false;
    const timer = setTimeout(async () => {
      setNotice('Finding Jira issues...');
      try {
        const result = await request({ action: 'suggest', query });
        if (disposed || generation.current !== current) return;
        const matches = (result.suggestions ?? []).slice(0, 10);
        setSuggestions(matches);
        setNotice(matches.length ? '' : 'No matching Jira issues.');
      } catch {
        if (!disposed && generation.current === current) setNotice('Jira suggestions unavailable.');
      }
    }, 300);
    return () => { disposed = true; clearTimeout(timer); };
  }, [input, query, enabled, busy, request]);

  const select = (key: string) => { dismiss(); onChange(key); };
  return (
    <div className="field jira-import-field">
      <label htmlFor="jira-import">Jira issue URL or key</label>
      <input id="jira-import" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
        aria-controls={listId} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off" value={input} disabled={busy}
        onChange={(event) => { dismiss(); onChange(event.target.value); setEnabled(true); }}
        onBlur={dismiss} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
          if (!suggestions.length) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(event.key === 'ArrowDown' ? (active + 1) % suggestions.length : (active <= 0 ? suggestions.length : active) - 1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            select(suggestions[Math.max(active, 0)].key);
          }
        }} />
      {suggestions.length > 0 && <ul id={listId} role="listbox" aria-label="Jira issue suggestions" className="jira-suggestions">
        {suggestions.map((suggestion, index) => <li key={suggestion.key} id={`${listId}-${index}`} role="option"
          aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onClick={() => select(suggestion.key)}>
          <strong>{suggestion.key}</strong> <span>{suggestion.summary}</span>
        </li>)}
      </ul>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

export function JiraPanel({ status, state, request }: { status: JiraStatus | null; state: RoomState; request: Request }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authorizeUrl, setAuthorizeUrl] = useState('');
  const [estimateFeedback, setEstimateFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const live = useRef(true);
  const popupRef = useRef<Window | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; popupRef.current?.close(); };
  }, []);
  useEffect(() => {
    if (status?.connected || status?.sites?.length || status?.available === false) {
      setAuthorizeUrl('');
      popupRef.current?.close();
      popupRef.current = null;
    }
  }, [status?.connected, status?.available, status?.site?.id, status?.sites?.length]);

  const estimateRequest = async (target: RoomTicket, action: JiraRequest): Promise<JiraResult> => {
    const key = target.jira!.key;
    setEstimateFeedback({ error: false, message: action.action === 'agree'
      ? `Saving the agreement for ${key} in this room...`
      : action.action === 'confirm' ? `Updating ${key} in Jira...` : `Checking the Jira update for ${key}...` });
    try {
      const result = await request(action);
      if (!live.current) return result;
      if (action.action === 'agree') {
        setEstimateFeedback({ error: false,
          message: `Agreement saved locally for ${key}: ${action.points} story points. Jira has not been updated.` });
      } else if (action.action === 'confirm') {
        if (result.uncertain) {
          setEstimateFeedback({ error: true,
            message: `Jira update outcome is uncertain for ${key}. Check the issue in Jira before trying again. Your saved estimate is kept.` });
        } else if (result.written === true) {
          setEstimateFeedback({ error: false,
            message: `Jira updated successfully: ${key} is now ${target.agreedEstimate} story points.` });
        } else {
          setEstimateFeedback({ error: true,
            message: `Jira update for ${key} could not be verified. Check the issue in Jira before trying again. Your saved estimate is kept.` });
        }
      } else {
        setEstimateFeedback(null);
      }
      return result;
    } catch (failure) {
      if (live.current) {
        const detail = errorText(failure);
        const uncertain = /uncertain|unknown|timed out|connection changed/i.test(detail);
        const message = action.action === 'agree' ? `Could not save the local agreement for ${key}: ${detail}`
          : action.action === 'confirm' ? uncertain
            ? `Jira update for ${key} could not be verified: ${detail} Check Jira before trying again. Your saved estimate is kept.`
            : `Jira update failed for ${key}: ${detail} Your saved estimate is kept.`
          : `Could not prepare the Jira update for ${key}: ${detail} Your saved estimate is kept.`;
        setEstimateFeedback({ error: true, message });
      }
      throw failure;
    }
  };

  const run = async (action: JiraRequest, popup?: Window | null) => {
    if (action.action === 'disconnect') {
      popupRef.current?.close();
      popupRef.current = null;
    }
    setBusy(true);
    setError('');
    setAuthorizeUrl('');
    try {
      const result = await request(action);
      if (!live.current) { popup?.close(); return; }
      if (action.action === 'connect') {
        const url = safeJiraUrl(result.authorizeUrl);
        if (!url) throw new Error('Jira did not return a valid authorization URL.');
        if (popup && !popup.closed) {
          popup.location.href = url;
        } else {
          setAuthorizeUrl(url);
        }
      }
      if (action.action === 'import') setInput('');
    } catch (error) {
      popup?.close();
      if (live.current) setError(errorText(error));
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const ticket = state.tickets.find((ticket) => ticket.id === state.activeTicketId);
  const estimateContext = JSON.stringify([state.round, state.activeTicketId, state.hostId, status]);

  return (
    <section className="card jira-panel" aria-labelledby="jira-heading">
      <h2 id="jira-heading">Jira</h2>
      {!status ? <p role="status">Checking Jira availability...</p> : !status.available ? (
        <p>{status.reason || 'Jira is unavailable.'}</p>
      ) : <>
        <p>{status.connected ? `Connected${status.site ? ` to ${status.site.name}` : ''}` : 'Not connected'}</p>
        {status.reason && <p>{status.reason}</p>}
        {!status.connected && <button type="button" disabled={busy} onClick={() => {
          popupRef.current?.close();
          const popup = window.open('about:blank', '_blank');
          if (popup) popup.opener = null;
          popupRef.current = popup;
          const returnUrl = new URL(window.location.pathname, window.location.origin);
          const room = new URLSearchParams(window.location.search).get('room');
          if (room) returnUrl.searchParams.set('room', room);
          void run({ action: 'connect', returnUrl: returnUrl.href }, popup);
        }}>Connect Jira</button>}
        {authorizeUrl && <a href={authorizeUrl} target="_blank" rel="noopener noreferrer">Continue Jira connection in a new tab</a>}
        {!!status.sites?.length && <div className="field">
          <label htmlFor="jira-site">Jira site</label>
          <select id="jira-site" value={status.site?.id ?? ''} disabled={busy} onChange={(event) => {
            if (event.target.value) void run({ action: 'selectSite', siteId: event.target.value });
          }}>
            <option value="">Choose site</option>
            {status.sites.map((site) => <option key={site.id} value={site.id}>{site.name} ({site.url})</option>)}
          </select>
        </div>}
        {(status.connected || !!status.sites?.length || !!authorizeUrl || !!popupRef.current) && (
          <button type="button" disabled={busy} onClick={() => void run({ action: 'disconnect' })}>Disconnect Jira</button>
        )}
        {status.connected && <>
          {status.site && <form className="ticket-form" onSubmit={(event) => {
            event.preventDefault();
            if (input.trim() && !busy) void run({ action: 'import', input: input.trim() });
          }}>
            <JiraImportInput key={JSON.stringify([state.hostId, status.site.id])}
              input={input} onChange={setInput} busy={busy} request={request} />
            <button type="submit" disabled={busy || !input.trim()}>Import issue</button>
          </form>}
        </>}
      </>}
      {busy && <p role="status">Waiting for Jira...</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {estimateFeedback && <p className={estimateFeedback.error ? 'notice error' : 'notice'}
        role={estimateFeedback.error ? 'alert' : 'status'}>{estimateFeedback.message}</p>}
      {status?.available && status.connected && status.site && !busy && state.revealed && ticket?.jira && ticket.type === 'story' && ticket.result && (
        <JiraEstimate key={estimateContext} ticket={ticket} request={(action) => estimateRequest(ticket, action)} />
      )}
    </section>
  );
}