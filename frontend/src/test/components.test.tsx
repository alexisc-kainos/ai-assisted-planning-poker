import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JoinForm } from '../JoinForm';
import { Roster } from '../Roster';
import { TicketPanel } from '../TicketPanel';
import type { RoomTicket } from '../types';
import { VoteDeck } from '../VoteDeck';

describe('JoinForm', () => {
  const setup = () => {
    const onJoin = vi.fn();
    render(<JoinForm onJoin={onJoin} />);
    return {
      onJoin,
      user: userEvent.setup(),
      name: screen.getByLabelText('Your name'),
      join: screen.getByRole('button', { name: 'Join room' }),
    };
  };

  it('offers at least the required animal avatars', () => {
    setup();
    for (const label of ['Capybara', 'Stork', 'Penguin', 'Cat', 'Dog']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('keeps Join disabled until a valid name and an avatar are provided', async () => {
    const { user, name, join, onJoin } = setup();
    expect(join).toBeDisabled();

    await user.type(name, '  Alice  ');
    expect(join).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Capybara' }));
    expect(join).toBeEnabled();

    await user.click(join);
    expect(onJoin).toHaveBeenCalledWith('Alice', 'capybara');
  });

  it('requires an avatar even with a valid name', async () => {
    const { user, name, join } = setup();
    await user.type(name, 'Alice');
    expect(join).toBeDisabled();
    expect(screen.getByText('Pick an avatar to join.')).toBeInTheDocument();
  });

  it('shows "Name is required" for a blank name', async () => {
    const { user, name, join } = setup();
    await user.type(name, '   ');
    await user.click(screen.getByRole('radio', { name: 'Dog' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(join).toBeDisabled();
  });

  it('shows feedback for a name that is too long', async () => {
    const { user, name, join } = setup();
    await user.type(name, 'x'.repeat(33));
    await user.click(screen.getByRole('radio', { name: 'Cat' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name must be 32 characters or fewer');
    expect(join).toBeDisabled();
  });

  it('does not nag before the user interacts', () => {
    setup();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Roster', () => {
  it('lists everyone, allows duplicates and marks the host and me', () => {
    render(
      <Roster
        hostId="user-1"
        meId="user-2"
        users={[
          { id: 'user-1', name: 'Sam', avatar: 'penguin', hasVoted: false },
          { id: 'user-2', name: 'Sam', avatar: 'penguin', hasVoted: false },
          { id: 'user-3', name: 'Kim', hasVoted: false },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'In the room (3)' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Sam');
    expect(items[0]).toHaveTextContent('Host');
    expect(items[1]).toHaveTextContent('Sam (you)');
    expect(items[1]).not.toHaveTextContent('Host');
    expect(screen.getAllByText('Host')).toHaveLength(1);
  });

  it('shows a Voted or Waiting badge for everyone without any vote values', () => {
    render(
      <Roster
        hostId="user-1"
        meId="user-1"
        users={[
          { id: 'user-1', name: 'Sam', hasVoted: true },
          { id: 'user-2', name: 'Kim', hasVoted: false },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Voted');
    expect(items[0]).not.toHaveTextContent('Waiting');
    expect(items[1]).toHaveTextContent('Waiting');
    expect(items[1]).not.toHaveTextContent('Voted');
  });
});

describe('VoteDeck', () => {
  it('offers the story-point deck and marks only the selected card as pressed', async () => {
    const onVote = vi.fn();
    render(<VoteDeck selected="5" onVote={onVote} />);
    const cards = screen.getAllByRole('button');
    expect(cards.map((card) => card.textContent)).toEqual(['1', '2', '3', '5', '8', '13', '20', '☕']);
    expect(screen.getByRole('button', { name: 'Coffee break' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '8' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Coffee break' }));
    expect(onVote).toHaveBeenCalledWith('☕');
  });

  it('disables every card when voting is locked', () => {
    render(<VoteDeck selected={null} disabled onVote={vi.fn()} />);
    for (const card of screen.getAllByRole('button')) expect(card).toBeDisabled();
  });
});

describe('TicketPanel', () => {
  const ticket = (id: string, content: string, result: RoomTicket['result'] = null): RoomTicket => ({
    id,
    type: 'story',
    content,
    result,
  });

  const renderPanel = (props: Partial<Parameters<typeof TicketPanel>[0]> = {}) => {
    const handlers = { onAdd: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), onSelect: vi.fn() };
    render(<TicketPanel tickets={[]} activeTicketId={null} isHost {...handlers} {...props} />);
    return handlers;
  };

  it('lets the host add a story ticket with Spike shown but disabled', async () => {
    const { onAdd } = renderPanel();
    expect(screen.getByRole('heading', { name: 'Tickets (0/10)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Story' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Spike' })).toBeDisabled();

    const user = userEvent.setup();
    const submit = screen.getByRole('button', { name: 'Add ticket' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('What are we estimating?'), '  Login{Enter}page  ');
    await user.click(submit);
    expect(onAdd).toHaveBeenCalledWith('Login\npage');
  });

  it('validates blank and over-long ticket text', async () => {
    renderPanel();
    const user = userEvent.setup();
    const textarea = screen.getByLabelText('What are we estimating?');
    await user.type(textarea, '   ');
    expect(screen.getByRole('alert')).toHaveTextContent('Ticket text is required');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');

    await user.clear(textarea);
    await user.click(textarea);
    await user.paste('x'.repeat(501));
    expect(screen.getByRole('alert')).toHaveTextContent('Ticket must be 500 characters or fewer');
    expect(screen.getByRole('button', { name: 'Add ticket' })).toBeDisabled();
  });

  it('blocks adding an 11th ticket with a clear message', async () => {
    const { onAdd } = renderPanel({
      tickets: Array.from({ length: 10 }, (_, i) => ticket(`t${i}`, `Ticket ${i + 1}`)),
    });
    expect(screen.getByRole('heading', { name: 'Tickets (10/10)' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent("You've reached the limit of 10 tickets.");
    await userEvent.setup().type(screen.getByLabelText('What are we estimating?'), 'One more');
    expect(screen.getByRole('button', { name: 'Add ticket' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('marks the active ticket and lets the host switch to any other ticket', async () => {
    const { onSelect } = renderPanel({
      tickets: [ticket('t1', 'One'), ticket('t2', 'Two'), ticket('t3', 'Three')],
      activeTicketId: 't1',
    });
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[0]).toHaveTextContent('Active');
    expect(items[2]).not.toHaveAttribute('aria-current');
    expect(within(items[0]).queryByRole('button', { name: 'Start voting' })).not.toBeInTheDocument();

    await userEvent.setup().click(within(items[2]).getByRole('button', { name: 'Start voting' }));
    expect(onSelect).toHaveBeenCalledWith('t3');
  });

  it('edits a ticket inline, including the active one, and can cancel', async () => {
    const { onEdit } = renderPanel({ tickets: [ticket('t1', 'One')], activeTicketId: 't1' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Edit ticket text')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByLabelText('Edit ticket text');
    await user.clear(editor);
    await user.type(editor, ' One with SSO ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('t1', 'One with SSO');
    expect(screen.queryByLabelText('Edit ticket text')).not.toBeInTheDocument();
  });

  it('removes a ticket only after the host confirms', async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    const { onRemove } = renderPanel({ tickets: [ticket('t1', 'One')], activeTicketId: 't1' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('t1');
  });

  it('shows a non-host the list as read-only text with no management controls', () => {
    renderPanel({ isHost: false, tickets: [ticket('t1', '<b>Login</b>')], activeTicketId: null });
    expect(screen.getByText('<b>Login</b>')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the host to choose a ticket.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('tells a host when no ticket is active', () => {
    renderPanel({ tickets: [ticket('t1', 'One')], activeTicketId: null });
    expect(screen.getByText('No ticket is active. Choose one to start voting.')).toBeInTheDocument();
  });

  it('tells other participants when there are no tickets yet', () => {
    renderPanel({ isHost: false });
    expect(screen.getByText('Waiting for the host to add a ticket.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('marks revealed tickets and toggles their stored results', async () => {
    renderPanel({
      isHost: false,
      tickets: [ticket('t1', 'One', { users: [{ id: 'u1', name: 'Sam' }, { id: 'u2', name: 'Kim' }], votes: { u1: '5' } })],
    });
    expect(screen.getByRole('listitem')).toHaveTextContent('Revealed');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show results' }));
    expect(screen.getByRole('button', { name: 'Hide results' })).toHaveAttribute('aria-expanded', 'true');
    const participants = within(screen.getByRole('list', { name: 'Participant votes' })).getAllByRole('listitem');
    expect(participants.map((row) => row.textContent)).toEqual(['Sam5', 'KimNo vote']);
  });
});
