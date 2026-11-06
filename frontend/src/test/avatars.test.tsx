import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AVATARS, Avatar } from '../avatars';
import { JoinForm } from '../JoinForm';
import { Roster } from '../Roster';

describe('supplied avatar artwork', () => {
  it('offers exactly the 20 supplied portraits, including both foxes', () => {
    expect(AVATARS.filter((avatar) => avatar.image)).toHaveLength(20);
    expect(new Set(AVATARS.map((avatar) => avatar.id)).size).toBe(20);
    expect(new Set(AVATARS.map((avatar) => avatar.label)).size).toBe(20);
    for (const id of ['capybara', 'stork', 'penguin', 'cat', 'dog', 'fox', 'woodland-fox']) {
      expect(AVATARS.find((avatar) => avatar.id === id)).toBeDefined();
    }
    for (const { id } of AVATARS) expect(id.length).toBeLessThanOrEqual(32);
  });

  it.each(AVATARS.filter((avatar) => avatar.image))('renders $label using its supplied portrait', ({ id, image }) => {
    const { container } = render(<Avatar id={id} size={44} />);
    const portrait = container.querySelector('img');
    expect(portrait).toHaveAttribute('src', image);
    expect(portrait).toHaveAttribute('width', '44');
    expect(portrait).toHaveAttribute('height', '44');
    expect(portrait).toHaveAttribute('alt', '');
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it.each(['frog', 'bunny'])('keeps the legacy %s drawing available', (id) => {
    const { container } = render(<Avatar id={id} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container).not.toHaveTextContent('?');
  });

  it.each([undefined, 'unknown-animal'])('preserves the placeholder for %s', (id) => {
    const { container } = render(<Avatar id={id} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container).toHaveTextContent('?');
  });

  it('submits the new portrait identifier without changing the join contract', async () => {
    const onJoin = vi.fn();
    const user = userEvent.setup();
    render(<JoinForm onJoin={onJoin} />);
    expect(screen.getAllByRole('radio')).toHaveLength(20);
    expect(screen.queryByRole('radio', { name: 'Frog' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Bunny' })).not.toBeInTheDocument();
    for (const { label } of AVATARS) {
      expect(screen.getByText(label)).toHaveClass('visually-hidden');
    }
    await user.type(screen.getByLabelText('Your name'), '  Robin  ');
    await user.click(screen.getByRole('radio', { name: 'Woodland fox' }));
    await user.click(screen.getByRole('button', { name: 'Join room' }));
    expect(onJoin).toHaveBeenCalledWith('Robin', 'woodland-fox');
  });

  it('uses the same portrait in the roster without changing the accessible participant name', () => {
    const { container } = render(
      <Roster
        users={[{ id: 'alice', name: 'Alice', avatar: 'red-panda', hasVoted: false, spectating: false, away: false }]}
        hostId="alice"
        meId="alice"
      />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Alice (you)HostWaiting');
    expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('red-panda.jpg'));
  });
});
