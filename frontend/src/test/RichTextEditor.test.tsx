import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from '../RichTextEditor';
import type { AdfDocument } from '../types';

describe('RichTextEditor', () => {
  it('exposes accessible controls and preserves unsupported ADF payloads through edits', async () => {
    const document: AdfDocument = { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Editable text' }] },
      { type: 'panel', attrs: { panelType: 'info' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Panel content' }] }] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'media-1' } }] },
    ] };
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RichTextEditor label="Description" document={document} issueUrl="https://team.atlassian.net/browse/PPK-1" disabled={false} onChange={onChange} />);

    expect(await screen.findByRole('textbox', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByText('Panel content')).toBeInTheDocument();
    expect(screen.getByText('Attachment in Jira')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle header row' })).toBeInTheDocument();
    const editor = screen.getByRole('textbox', { name: 'Description' });
    await user.click(editor);
    await user.type(editor, '!');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as AdfDocument;
    expect(screen.getByText('Panel content')).toBeInTheDocument();
    expect(screen.getByText('Attachment in Jira')).toBeInTheDocument();
    expect(updated.content).toContainEqual(document.content[1]);
    expect(updated.content).toContainEqual(document.content[2]);
  });

  it('inserts table structure through the toolbar', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RichTextEditor label="Description" document={{ type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Editable text' }] },
    ] }} issueUrl="https://team.atlassian.net/browse/PPK-1" disabled={false} onChange={onChange} />);

    await user.click(await screen.findByRole('textbox', { name: 'Description' }));
    await user.type(screen.getByRole('textbox', { name: 'Description' }), ' more');
    await user.click(screen.getByRole('button', { name: 'Insert table' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as AdfDocument;
    expect(updated.content.some((node) => node.type === 'table')).toBe(true);
  });
});