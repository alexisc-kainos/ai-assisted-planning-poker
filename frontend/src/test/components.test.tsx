import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JoinForm } from '../JoinForm';
import { Roster } from '../Roster';
import { TicketPanel } from '../TicketPanel';
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
  it('lets the host enter a story ticket with Spike shown but disabled', async () => {
    const onSetTicket = vi.fn();
    render(<TicketPanel ticket={null} isHost onSetTicket={onSetTicket} />);
    expect(screen.getByRole('radio', { name: 'Story' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Spike' })).toBeDisabled();

    const user = userEvent.setup();
    const submit = screen.getByRole('button', { name: 'Set ticket' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('What are we estimating?'), '  Login{Enter}page  ');
    await user.click(submit);
    expect(onSetTicket).toHaveBeenCalledWith('Login\npage');
  });

  it('validates blank and over-long ticket text', async () => {
    render(<TicketPanel ticket={null} isHost onSetTicket={vi.fn()} />);
    const user = userEvent.setup();
    const textarea = screen.getByLabelText('What are we estimating?');
    await user.type(textarea, '   ');
    expect(screen.getByRole('alert')).toHaveTextContent('Ticket text is required');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');

    await user.clear(textarea);
    await user.click(textarea);
    await user.paste('x'.repeat(501));
    expect(screen.getByRole('alert')).toHaveTextContent('Ticket must be 500 characters or fewer');
    expect(screen.getByRole('button', { name: 'Set ticket' })).toBeDisabled();
  });

  it('prefills the host editor with the current ticket', () => {
    render(<TicketPanel ticket={{ type: 'story', content: 'Login' }} isHost onSetTicket={vi.fn()} />);
    expect(screen.getByLabelText('What are we estimating?')).toHaveValue('Login');
    expect(screen.getByRole('button', { name: 'Update ticket' })).toBeEnabled();
  });

  it('shows other participants the ticket as read-only text', () => {
    render(
      <TicketPanel ticket={{ type: 'story', content: '<b>Login</b>' }} isHost={false} onSetTicket={vi.fn()} />,
    );
    expect(screen.getByText('Story')).toBeInTheDocument();
    expect(screen.getByText('<b>Login</b>')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('tells other participants when there is no ticket yet', () => {
    render(<TicketPanel ticket={null} isHost={false} onSetTicket={vi.fn()} />);
    expect(screen.getByText('Waiting for the host to add a ticket.')).toBeInTheDocument();
  });
});
