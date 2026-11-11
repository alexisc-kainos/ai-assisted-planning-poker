import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { JiraTicketOverlay } from '../JiraTicketOverlay';
import type { AdfDocument, JiraResult, JiraStatus, RoomTicket } from '../types';

const connectedStatus: JiraStatus = { available: true, connected: true, site: { id: 'cloud-1', name: 'Team Jira', url: 'https://team.atlassian.net' } };

const adfOf = (text: string): AdfDocument => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const linkedTicket = (overrides: Partial<RoomTicket> = {}): RoomTicket => ({
  id: 't1',
  type: 'story',
  title: 'Login page',
  description: '',
  result: null,
  jira: { cloudId: 'cloud-1', issueId: '10001', key: 'TEAM-7', url: 'https://team.atlassian.net/browse/TEAM-7' },
  descriptionAdf: adfOf('Original description'),
  ...overrides,
});

const manualTicket = (overrides: Partial<RoomTicket> = {}): RoomTicket => ({
  id: 't2',
  type: 'story',
  title: 'Manual ticket',
  description: 'Manual description',
  result: null,
  ...overrides,
});

describe('JiraTicketOverlay', () => {
  it('shows a non-host the title, Jira link and description without fetching or offering edit controls', () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost={false} jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Login page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TEAM-7' })).toBeInTheDocument();
    expect(screen.getByText('Original description')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('renders standard Jira descriptions containing only media', () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    render(<JiraTicketOverlay ticket={linkedTicket({ descriptionAdf: { type: 'doc', version: 1, content: [
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { alt: 'Design diagram' } }] },
    ] } })} isHost={false} jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Design diagram' })).toHaveAttribute('href', 'https://team.atlassian.net/browse/TEAM-7');
  });

  it('keeps attachments alongside placeholder text in Jira descriptions', () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    render(<JiraTicketOverlay ticket={linkedTicket({ descriptionAdf: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Given ... When ... Then ...' }] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { alt: 'Design diagram' } }] },
    ] } })} isHost={false} jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Design diagram' })).toHaveAttribute('href', 'https://team.atlassian.net/browse/TEAM-7');
  });

  it('shows imported custom descriptions to non-hosts and hides empty fields', () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    render(<JiraTicketOverlay ticket={linkedTicket({ descriptionAdf: adfOf('  '), extraFields: [
      { id: 'customfield_1', name: 'Description (Project_Name)', adf: adfOf('Project details') },
      { id: 'customfield_2', name: 'Empty description', adf: adfOf('  ') },
      { id: 'customfield_3', name: 'Customer value', adf: adfOf('Unrelated text') },
    ] })} isHost={false} jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Description (Project_Name)' })).toBeInTheDocument();
    expect(screen.getByText('Project details')).toBeInTheDocument();
    expect(screen.queryByText('Empty description')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer value')).not.toBeInTheDocument();
    expect(screen.queryByText('Unrelated text')).not.toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Jira description' })).toHaveLength(1);
  });

  it('shows descriptions before exact acceptance criteria and hides similarly named fields', () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    render(<JiraTicketOverlay ticket={linkedTicket({ extraFields: [
      { id: 'customfield_1', name: 'aCcEpTaNcE cRiTeRiA', adf: adfOf('Criteria text') },
      { id: 'customfield_2', name: 'Acceptance Criteria - Story', adf: adfOf('Unwanted criteria') },
      { id: 'customfield_3', name: 'Description (Project_Name)', adf: adfOf('Project description') },
    ] })} isHost={false} jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Description (Project_Name)', 'aCcEpTaNcE cRiTeRiA',
    ]);
    expect(screen.getByText('Criteria text')).toBeInTheDocument();
    expect(screen.queryByText('Unwanted criteria')).not.toBeInTheDocument();
  });

  it('fetches the latest details only for the facilitator of a Jira-linked ticket', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Updated title', descriptionAdf: adfOf('Updated description') },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(request).toHaveBeenCalledWith({ action: 'details', ticketId: 't1' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading the latest details from Jira');
    expect(await screen.findByRole('heading', { name: 'Updated title' })).toBeInTheDocument();
    expect(screen.getByText('Updated description')).toBeInTheDocument();
  });

  it('refreshes room ticket details without replacing an active edit draft', async () => {
    const mentionedDescription: AdfDocument = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [
      { type: 'mention', attrs: { text: '@Alex' } },
      { type: 'text', text: ' ' },
      { type: 'emoji', attrs: { shortName: ':rocket:' } },
    ] }] };
    const initial = linkedTicket({ descriptionAdf: mentionedDescription, extraFields: [
      { id: 'customfield_1', name: 'Acceptance Criteria', adf: adfOf('Initial criteria') },
    ] });
    const updated = linkedTicket({ title: 'Broadcast title', descriptionAdf: adfOf('Broadcast description'), extraFields: [
      { id: 'customfield_1', name: 'Acceptance Criteria', adf: adfOf('Broadcast criteria') },
    ] });
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: initial.title, descriptionAdf: mentionedDescription, extraFields: initial.extraFields },
    });
    const user = userEvent.setup();
    const props = { isHost: true, jiraStatus: connectedStatus, request, onClose: vi.fn() };
    const { rerender } = render(<JiraTicketOverlay ticket={initial} {...props} />);
    await screen.findByText('Initial criteria');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Description')).toHaveValue('@Alex :rocket:');
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Unsaved draft');

    rerender(<JiraTicketOverlay ticket={updated} {...props} />);

    expect(screen.getByLabelText('Title')).toHaveValue('Unsaved draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Broadcast title' })).toBeInTheDocument();
    expect(screen.getByText('Broadcast description')).toBeInTheDocument();
    expect(screen.getByText('Broadcast criteria')).toBeInTheDocument();
  });

  it('coalesces duplicate concurrent detail fetches for the same ticket (e.g. StrictMode double-invoked effects) into one request', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Updated title', descriptionAdf: adfOf('Updated description') },
    });
    render(
      <StrictMode>
        <JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />
      </StrictMode>,
    );
    expect(await screen.findByRole('heading', { name: 'Updated title' })).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('surfaces a reconnect message when the live fetch fails', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockRejectedValue(new Error('Reauthorise to continue.'));
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Reauthorise to continue.');
  });

  it('shows the acceptance-criteria section only when a matching field has a value', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Login page', descriptionAdf: adfOf('Original description') },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    await screen.findByText('Original description');
    expect(screen.queryByRole('heading', { name: 'Acceptance Criteria' })).not.toBeInTheDocument();
  });

  it('renders any discovered description/acceptance field once reported by the live fetch', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Login page', descriptionAdf: adfOf('Original description'),
        extraFields: [{ id: 'customfield_20001', name: 'Acceptance Criteria', adf: adfOf('Given a valid login, When the user submits, Then they see the dashboard') }] },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Acceptance Criteria' })).toBeInTheDocument();
    expect(screen.getByText('Given a valid login, When the user submits, Then they see the dashboard')).toBeInTheDocument();
  });

  it('hides an unfilled Given/When/Then placeholder field in the view but keeps it editable', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Login page', descriptionAdf: adfOf('Original description'),
        extraFields: [{ id: 'customfield_20001', name: 'Acceptance Criteria', adf: adfOf('Given ...\nWhen ...\nThen ...') }] },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    await screen.findByText('Original description');
    expect(screen.queryByRole('heading', { name: 'Acceptance Criteria' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Given/)).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Acceptance Criteria')).toHaveValue('Given ...\nWhen ...\nThen ...');
  });

  it('keeps embedded content in placeholder and non-text custom fields', () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    render(<JiraTicketOverlay ticket={linkedTicket({ extraFields: [
      { id: 'customfield_1', name: 'Acceptance Criteria', adf: { type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Given ... When ... Then ...' }] },
        { type: 'inlineCard', attrs: { url: 'https://example.com/design' } },
      ] } },
      { id: 'customfield_2', name: 'Description (Project_Name)', adf: { type: 'doc', version: 1, content: [
        { type: 'inlineCard', attrs: { url: 'https://example.com/attachment' } },
      ] } },
    ] })} isHost={false} jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Acceptance Criteria' })).toBeInTheDocument();
      const contentLinks = screen.getAllByRole('link', { name: 'View attachment or embedded content in Jira' });
      expect(contentLinks).toHaveLength(2);
      expect(contentLinks[0]).toHaveAttribute('href', 'https://team.atlassian.net/browse/TEAM-7');
      expect(contentLinks[1]).toHaveAttribute('href', 'https://team.atlassian.net/browse/TEAM-7');
  });

  it('still shows a partially filled Given/When/Then field that has real detail', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Login page', descriptionAdf: adfOf('Original description'),
        extraFields: [{ id: 'customfield_20001', name: 'Acceptance Criteria', adf: adfOf('Given ...\nWhen a user logs in\nThen ...') }] },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Acceptance Criteria' })).toBeInTheDocument();
    expect(screen.getByText(/a user logs in/)).toBeInTheDocument();
  });

  it('hides the main description in view mode when it is just an unfilled Given/When/Then template', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Login page', descriptionAdf: adfOf('Given ...\nWhen ...\nThen ...') },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Edit' });
    expect(screen.queryByText(/Given/)).not.toBeInTheDocument();
  });

  it('keeps the Edit button outside the scrollable content area', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Login page', descriptionAdf: adfOf('Original description') },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    await screen.findByText('Original description');
    const editButton = screen.getByRole('button', { name: 'Edit' });
    expect(editButton.closest('.ticket-overlay-content')).toBeNull();
  });

  it('never shows edit controls for a ticket that is not linked to Jira', () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    render(<JiraTicketOverlay ticket={manualTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('hides edit controls while not connected to the ticket Jira site', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>().mockResolvedValue({
      detail: { title: 'Login page', descriptionAdf: adfOf('Original description') },
    });
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={{ available: true, connected: false }} request={request} onClose={vi.fn()} />);
    await screen.findByText('Original description');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('edits title, description and discovered extra fields together, previews the diff and writes back once confirmed', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>()
      .mockResolvedValueOnce({ detail: { title: 'Login page', descriptionAdf: adfOf('Original description'),
        extraFields: [{ id: 'customfield_20001', name: 'Acceptance Criteria', adf: adfOf('Original criteria') }] } })
      .mockResolvedValueOnce({
        editPreview: {
          id: 'confirmation-1', issueKey: 'TEAM-7', issueUrl: 'https://team.atlassian.net/browse/TEAM-7', siteName: 'Team Jira',
          changes: [
            { fieldId: 'summary', fieldName: 'Summary', from: 'Login page', to: 'Login with SSO' },
            { fieldId: 'description', fieldName: 'Description', from: 'Original description', to: 'Updated description' },
            { fieldId: 'customfield_20001', fieldName: 'Acceptance Criteria', from: 'Original criteria', to: 'Updated criteria' },
          ],
        },
      })
      .mockResolvedValueOnce({ written: true });
    const user = userEvent.setup();
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    await screen.findByText('Original criteria');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Login with SSO');
    const description = screen.getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Updated description');
    const acceptanceCriteria = screen.getByLabelText('Acceptance Criteria');
    await user.clear(acceptanceCriteria);
    await user.type(acceptanceCriteria, 'Updated criteria');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(request).toHaveBeenLastCalledWith({
      action: 'prepareEdit', ticketId: 't1', title: 'Login with SSO', description: 'Updated description',
      extraFields: { customfield_20001: 'Updated criteria' },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Confirm Jira changes' });
    expect(dialog).toHaveTextContent('Login page');
    expect(dialog).toHaveTextContent('Login with SSO');
    expect(dialog).toHaveTextContent('Updated description');
    expect(dialog).toHaveTextContent('Updated criteria');

    await user.click(screen.getByRole('button', { name: 'Confirm write to Jira' }));
    expect(request).toHaveBeenLastCalledWith({ action: 'confirmEdit', confirmationId: 'confirmation-1' });
    expect(await screen.findByRole('status')).toHaveTextContent('Jira updated successfully.');
    expect(screen.getByRole('heading', { name: 'Login with SSO' })).toBeInTheDocument();
  });

  it('does not submit unchanged custom fields when editing the title', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>()
      .mockResolvedValueOnce({ detail: { title: 'Login page', descriptionAdf: adfOf('Original description'),
        extraFields: [{ id: 'customfield_1', name: 'Description (Project_Name)', adf: adfOf('Project details') }] } })
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<JiraTicketOverlay ticket={linkedTicket()} isHost jiraStatus={connectedStatus} request={request} onClose={vi.fn()} />);
    await screen.findByText('Project details');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Updated title');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(request).toHaveBeenLastCalledWith({
      action: 'prepareEdit', ticketId: 't1', title: 'Updated title', description: 'Original description',
    });
  });

  it('closes with Escape when no confirmation dialog is open', async () => {
    const request = vi.fn<(request: unknown) => Promise<JiraResult>>();
    const onClose = vi.fn();
    render(<JiraTicketOverlay ticket={manualTicket()} isHost={false} jiraStatus={connectedStatus} request={request} onClose={onClose} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
