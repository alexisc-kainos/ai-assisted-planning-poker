import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JoinForm } from '../JoinForm';
import { Roster } from '../Roster';

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
});
