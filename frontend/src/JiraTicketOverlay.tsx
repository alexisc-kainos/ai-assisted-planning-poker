import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { hasRenderableJiraContent, isRelevantJiraField, JiraDescription, JiraIssueLink } from './JiraDescription';
import { JiraTicketHeader } from './JiraTicketHeader';
import { jiraEditTextError, jiraTitleError } from './validation';
import type { AdfDocument, AdfNode, JiraEditPreview, JiraExtraField, JiraRequest, JiraResult, JiraStatus, RoomTicket } from './types';

type Request = (request: JiraRequest) => Promise<JiraResult>;
type Feedback = { error: boolean; message: string };

const RichTextEditor = lazy(() => import('./RichTextEditor').then(({ RichTextEditor: Editor }) => ({ default: Editor })));

// Coalesces duplicate concurrent 'details' fetches for the same ticket (e.g. React StrictMode's
// double-invoked effects in development) so they share one request instead of racing the
// backend's per-room busy lock.
const inFlightDetails = new Map<string, Promise<JiraResult>>();

function fetchDetailsOnce(request: Request, ticketId: string): Promise<JiraResult> {
  const existing = inFlightDetails.get(ticketId);
  if (existing) return existing;
  const promise = request({ action: 'details', ticketId }).finally(() => {
    if (inFlightDetails.get(ticketId) === promise) inFlightDetails.delete(ticketId);
  });
  inFlightDetails.set(ticketId, promise);
  return promise;
}

/** Flattens an ADF document to plain text for editing; paragraphs/headings/list items become lines. */
function adfToPlainText(doc: AdfDocument): string {
  const blocks: string[] = [];
  const textOf = (node: AdfNode): string => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return typeof node.attrs?.text === 'string' ? node.attrs.text : 'Mention in Jira';
    if (node.type === 'emoji') return typeof node.attrs?.text === 'string' ? node.attrs.text
      : typeof node.attrs?.shortName === 'string' ? node.attrs.shortName : '';
    return (node.content ?? []).map(textOf).join('');
  };
  const walk = (node: AdfNode): void => {
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(node.type)) {
      const text = (node.content ?? []).map(textOf).join('');
      if (text) blocks.push(text);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc as unknown as AdfNode);
  return blocks.join('\n\n');
}

/** Converts plain text back to a simple ADF document, mirroring the backend's write-back conversion. */
function plainTextToAdf(text: string): AdfDocument {
  const paragraphs = text.split(/\r?\n(?:\r?\n)+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return { type: 'doc', version: 1, content: paragraphs.map((paragraph) => ({ type: 'paragraph', content: paragraph.split(/\r?\n/).flatMap((line, index) => [
    ...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : []),
  ]) })) };
}

const emptyAdf: AdfDocument = { type: 'doc', version: 1, content: [] };

function adfDeepEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length &&
      first.every((value, index) => adfDeepEqual(value, second[index]));
  }
  if (typeof first !== 'object' || first === null || typeof second !== 'object' || second === null) return false;
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const firstKeys = Object.keys(firstRecord).sort();
  const secondKeys = Object.keys(secondRecord).sort();
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) =>
    key === secondKeys[index] && adfDeepEqual(firstRecord[key], secondRecord[key]));
}

const GWT_KEYWORD = /\b(given|when|then|and|but)\b/i;
const GWT_KEYWORDS_GLOBAL = /\b(given|when|then|and|but)\b/gi;
const PLACEHOLDER_FILLER = /[.\-_*…:;<>[\](),]/g;
const ADF_TEXT_NODE_TYPES = new Set(['text', 'mention', 'emoji', 'hardBreak']);
const ADF_CONTAINER_NODE_TYPES = new Set([
  'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock',
  'table', 'tableRow', 'tableHeader', 'tableCell', 'panel',
]);

function hasMeaningfulNonTextContent(node: AdfNode): boolean {
  if (ADF_TEXT_NODE_TYPES.has(node.type)) return false;
  if (!ADF_CONTAINER_NODE_TYPES.has(node.type)) return true;
  return node.content?.some(hasMeaningfulNonTextContent) ?? false;
}

/** True when the document is just an unfilled Given/When/Then template, with no real detail. */
function isGwtPlaceholder(doc: AdfDocument): boolean {
  if (hasMeaningfulNonTextContent(doc)) return false;
  const text = adfToPlainText(doc);
  if (!GWT_KEYWORD.test(text)) return false;
  const withoutKeywords = text.replace(GWT_KEYWORDS_GLOBAL, ' ');
  const meaningful = withoutKeywords.replace(PLACEHOLDER_FILLER, '').replace(/\s+/g, '');
  return meaningful.length === 0;
}

function EditConfirmDialog({ preview, busy, onConfirm, onCancel, returnFocus, issueUrl }: {
  preview: JiraEditPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocus: { current: HTMLButtonElement | null };
  issueUrl: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, []);
  return (
    <div className="jira-dialog-backdrop">
      <div className="card jira-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="jira-edit-confirm-heading"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
          if (event.key !== 'Tab') return;
          const controls = dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)');
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
        <h2 id="jira-edit-confirm-heading">Confirm Jira changes</h2>
        <p><JiraIssueLink url={preview.issueUrl}>{preview.issueKey}</JiraIssueLink> on {preview.siteName}</p>
        <dl>
          {preview.changes.map((change) => (
            <div key={change.fieldId} className="jira-edit-change">
              <dt>{change.fieldName}</dt>
              <dd>From: {change.fromAdf ? <JiraDescription document={change.fromAdf} issueUrl={issueUrl} /> : change.from || '(empty)'}</dd>
              <dd>To: {change.toAdf ? <JiraDescription document={change.toAdf} issueUrl={issueUrl} /> : change.to || '(empty)'}</dd>
            </div>
          ))}
        </dl>
        <div className="vote-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="primary" onClick={onConfirm} disabled={busy}>Confirm write to Jira</button>
        </div>
      </div>
    </div>
  );
}

interface JiraTicketOverlayProps {
  ticket: RoomTicket;
  isHost: boolean;
  jiraStatus: JiraStatus | null;
  request: Request;
  onClose: () => void;
}

export function JiraTicketOverlay({ ticket, isHost, jiraStatus, request, onClose }: JiraTicketOverlayProps) {
  const canEditJira = isHost && !!ticket.jira;
  const [title, setTitle] = useState(ticket.title);
  const [descriptionAdf, setDescriptionAdf] = useState(ticket.descriptionAdf);
  const [extraFields, setExtraFields] = useState<JiraExtraField[]>((ticket.extraFields ?? []).filter((field) => isRelevantJiraField(field.name))
    .sort((first, second) => Number(/description/i.test(second.name)) - Number(/description/i.test(first.name))));
  const [loading, setLoading] = useState(canEditJira);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDescription, setDraftDescription] = useState<AdfDocument>(descriptionAdf ?? emptyAdf);
  const [draftExtraFields, setDraftExtraFields] = useState<Record<string, string | AdfDocument>>({});
  const [preview, setPreview] = useState<JiraEditPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    closeButton.current?.focus();
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    setTitle(ticket.title);
    setDescriptionAdf(ticket.descriptionAdf);
    setExtraFields((ticket.extraFields ?? []).filter((field) => isRelevantJiraField(field.name))
      .sort((first, second) => Number(/description/i.test(second.name)) - Number(/description/i.test(first.name))));
  }, [ticket.title, ticket.descriptionAdf, ticket.extraFields]);

  useEffect(() => {
    if (!canEditJira) return;
    fetchDetailsOnce(request, ticket.id).then((result) => {
      if (!live.current || !result.detail) return;
      setTitle(result.detail.title);
      setDescriptionAdf(result.detail.descriptionAdf);
      setExtraFields((result.detail.extraFields ?? []).filter((field) => isRelevantJiraField(field.name))
        .sort((first, second) => Number(/description/i.test(second.name)) - Number(/description/i.test(first.name))));
    }).catch((error: unknown) => {
      if (live.current) setLoadError(error instanceof Error ? error.message : 'Could not load the latest Jira details.');
    }).finally(() => {
      if (live.current) setLoading(false);
    });
    // Fetch once per overlay open; the ticket identity is fixed for this component's lifetime.
  }, []);

  const startEditing = () => {
    setDraftTitle(title);
    setDraftDescription(descriptionAdf ?? emptyAdf);
    setDraftExtraFields(Object.fromEntries(extraFields.map((field) => [field.id,
      field.kind === 'string' ? adfToPlainText(field.adf) : field.adf])));
    setFeedback(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setPreview(null);
  };

  const titleError = jiraTitleError(draftTitle);
  const descriptionText = adfToPlainText(draftDescription);
  const descriptionError = jiraEditTextError(descriptionText);
  const extraFieldErrors = extraFields.map((field) => {
    const value = draftExtraFields[field.id] ?? (field.kind === 'string' ? '' : emptyAdf);
    return jiraEditTextError(typeof value === 'string' ? value : adfToPlainText(value));
  });
  const hasFieldErrors = extraFieldErrors.some(Boolean);

  const save = async () => {
    if (titleError || descriptionError || hasFieldErrors || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const changedFields = extraFields.filter((field) => {
        const value = draftExtraFields[field.id] ?? (field.kind === 'string' ? '' : field.adf);
        return field.kind === 'string'
          ? typeof value !== 'string' || value.trim() !== adfToPlainText(field.adf).trim()
          : typeof value === 'string' || !adfDeepEqual(value, field.adf);
      });
      // Match the backend's MAX_JIRA_EXTRA_FIELDS limit.
      if (changedFields.length > 10) {
        throw new Error('You can save up to 10 custom fields at once. Revert some field changes before saving, then edit those fields separately.');
      }
      const result = await request({
        action: 'prepareEdit', ticketId: ticket.id, title: draftTitle.trim(), description: draftDescription,
        ...(changedFields.length ? { extraFields: Object.fromEntries(changedFields.map((field) => [field.id, draftExtraFields[field.id]])) } : {}),
      });
      if (!live.current) return;
      if (result.editPreview) setPreview(result.editPreview);
    } catch (error) {
      if (live.current) setFeedback({ error: true, message: error instanceof Error ? error.message : 'Could not prepare the Jira update.' });
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const result = await request({ action: 'confirmEdit', confirmationId: preview.id });
      if (!live.current) return;
      if (result.uncertain) {
        setFeedback({ error: true, message: 'Jira update outcome is uncertain. Check the issue in Jira before trying again.' });
      } else if (result.written === true) {
        setTitle(draftTitle);
        if (preview.changes.some((change) => change.fieldId === 'description')) {
          setDescriptionAdf(draftDescription);
        }
        setExtraFields(extraFields.map((field) => {
          const value = draftExtraFields[field.id];
          if (value === undefined) return field;
          if (field.kind === 'string' && typeof value === 'string') {
            return { ...field, adf: plainTextToAdf(value), kind: 'string' as const };
          }
          if (field.kind !== 'string' && typeof value !== 'string') return { ...field, adf: value, kind: 'adf' as const };
          return field;
        }));
        setFeedback({ error: false, message: 'Jira updated successfully.' });
        setEditing(false);
      } else {
        setFeedback({ error: true, message: 'Jira update could not be verified. Check the issue in Jira before trying again.' });
      }
      setPreview(null);
    } catch (error) {
      setPreview(null);
      if (live.current) setFeedback({ error: true, message: error instanceof Error ? error.message : 'Jira update failed.' });
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return (
    <div className="ticket-overlay-backdrop">
      <div className="card ticket-overlay" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="ticket-overlay-heading"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !preview) { event.preventDefault(); onClose(); }
          if (event.key !== 'Tab' || preview) return;
          const controls = dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[contenteditable="true"],[tabindex]:not([tabindex="-1"]):not(:disabled)');
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
        <div className="ticket-overlay-header">
          {ticket.jira && !editing ? (
            <JiraTicketHeader jiraKey={ticket.jira.key} jiraUrl={ticket.jira.url} title={<h2 id="ticket-overlay-heading">{title}</h2>} />
          ) : ticket.jira ? (
            <div className="jira-ticket-header">
              <JiraIssueLink url={ticket.jira.url}>
                <span className="jira-ticket-key">{ticket.jira.key}</span>
              </JiraIssueLink>
              <h2 id="ticket-overlay-heading">Edit ticket</h2>
            </div>
          ) : (
            <h2 id="ticket-overlay-heading">{editing ? 'Edit ticket' : title}</h2>
          )}
          <button type="button" ref={closeButton} onClick={onClose} aria-label="Close ticket details">Close</button>
        </div>
        {loading && <p role="status">Loading the latest details from Jira...</p>}
        {loadError && <p className="notice error" role="alert">{loadError}</p>}
        {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
        {!editing ? (
          <>
            <div className="ticket-overlay-content">
              {ticket.jira ? descriptionAdf && hasRenderableJiraContent(descriptionAdf) && !isGwtPlaceholder(descriptionAdf) && (
                <JiraDescription document={descriptionAdf} issueUrl={ticket.jira.url} />
              ) : ticket.description && <p>{ticket.description}</p>}
              {ticket.jira && extraFields.filter((field) => hasRenderableJiraContent(field.adf) && !isGwtPlaceholder(field.adf)).map((field) => (
                <section key={field.id} aria-labelledby={`extra-field-${field.id}-heading`}>
                  <h3 id={`extra-field-${field.id}-heading`} className="jira-field-name">{field.name}</h3>
                  <JiraDescription document={field.adf} issueUrl={ticket.jira!.url} />
                </section>
              ))}
            </div>
            {canEditJira && jiraStatus?.connected && (
              <button type="button" className="ticket-overlay-edit" onClick={startEditing} disabled={loading}>Edit</button>
            )}
          </>
        ) : (
          <form className="ticket-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <div className="ticket-form-fields">
              <div className="field">
                <label htmlFor="jira-edit-title">Title</label>
                <input id="jira-edit-title" type="text" value={draftTitle} disabled={busy}
                  onChange={(event) => setDraftTitle(event.target.value)} />
                {titleError && <p className="field-error" role="alert">{titleError}</p>}
              </div>
              <div className="field">
                <label htmlFor="jira-edit-description">Description</label>
                <Suspense fallback={<p role="status">Loading rich-text editor...</p>}>
                  <RichTextEditor id="jira-edit-description" label="Description" document={draftDescription} issueUrl={ticket.jira?.url ?? ''}
                    disabled={busy} invalid={!!descriptionError} describedBy={descriptionError ? 'jira-edit-description-error' : undefined}
                    onChange={setDraftDescription} />
                </Suspense>
                {descriptionError && <p id="jira-edit-description-error" className="field-error" role="alert">{descriptionError}</p>}
              </div>
              {extraFields.map((field, index) => (
                <div className="field" key={field.id}>
                  <label htmlFor={`jira-edit-extra-${field.id}`}>{field.name}</label>
                  {field.kind === 'string' ? (
                    <textarea id={`jira-edit-extra-${field.id}`} rows={6} value={typeof draftExtraFields[field.id] === 'string' ? draftExtraFields[field.id] as string : ''} disabled={busy}
                      onChange={(event) => setDraftExtraFields((current) => ({ ...current, [field.id]: event.target.value }))} />
                  ) : (
                    <Suspense fallback={<p role="status">Loading rich-text editor...</p>}>
                      <RichTextEditor id={`jira-edit-extra-${field.id}`} label={field.name} document={typeof draftExtraFields[field.id] === 'string' || !draftExtraFields[field.id]
                        ? field.adf : draftExtraFields[field.id] as AdfDocument} issueUrl={ticket.jira?.url ?? ''} disabled={busy}
                        invalid={!!extraFieldErrors[index]} describedBy={extraFieldErrors[index] ? `jira-edit-extra-${field.id}-error` : undefined}
                        onChange={(value) => setDraftExtraFields((current) => ({ ...current, [field.id]: value }))} />
                    </Suspense>
                  )}
                  {extraFieldErrors[index] && <p id={`jira-edit-extra-${field.id}-error`} className="field-error" role="alert">{extraFieldErrors[index]}</p>}
                </div>
              ))}
            </div>
            <div className="vote-actions">
              <button ref={saveButton} type="submit" className="primary"
                disabled={busy || !!titleError || !!descriptionError || hasFieldErrors}>Save</button>
              <button type="button" onClick={cancelEditing} disabled={busy}>Cancel</button>
            </div>
          </form>
        )}
        {preview && <EditConfirmDialog preview={preview} busy={busy} returnFocus={saveButton} issueUrl={ticket.jira?.url ?? ''}
          onCancel={() => setPreview(null)} onConfirm={() => void confirm()} />}
      </div>
    </div>
  );
}
