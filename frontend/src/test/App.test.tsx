import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

describe('App top bar', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('shows the app name without a room code on the landing page', () => {
    window.history.replaceState(null, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Planning Poker' })).toBeInTheDocument();
    expect(screen.queryByText('Room')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a room' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome to Planning Poker' })).toBeInTheDocument();
    expect(screen.queryByText(/no accounts needed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).not.toHaveTextContent('Riverside Lounge');
  });

  describe('supplied riverside artwork', () => {
    it('replaces the illustration without changing the existing landing shell', () => {
      const { container } = render(<App />);
      const scene = container.querySelector('.narrow .landing img.mascot');
      expect(scene).toHaveAttribute('src', expect.stringContaining('riverside.jpg'));
      expect(scene).toHaveAttribute('alt', '');
      expect(scene).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('shows the room code inside a valid room', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    window.history.replaceState(null, '', '/?room=k7mq-2xpa');
    render(<App />);
    expect(screen.getByRole('banner')).toHaveTextContent('Room k7mq-2xpa');
  });

  it('shows no room code for an invalid room link', () => {
    window.history.replaceState(null, '', '/?room=NOT_VALID');
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent("This room link isn't valid.");
    expect(screen.getByRole('banner')).not.toHaveTextContent('Room');
  });
});
