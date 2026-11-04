import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Mascot } from '../Mascot';

describe('supplied riverside illustration', () => {
  it.each([
    [0, 'riverside.jpg'],
    [1, 'riverside-2.jpg'],
    [2, 'riverside-3.jpg'],
    [3, 'riverside-4.jpg'],
    [4, 'riverside.jpg'],
    [5, 'riverside-2.jpg'],
    [6, 'riverside-3.jpg'],
    [7, 'riverside-4.jpg'],
  ])('cycles the scene for ticket index %i', (ticketIndex, filename) => {
    const { container } = render(<Mascot ticketIndex={ticketIndex} />);
    expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining(filename));
  });

  it.each(['mascot', 'mascot room-mascot'])('preserves the existing %s placement hook', (className) => {
    const { container } = render(<Mascot className={className} />);
    const scene = container.querySelector('img');
    expect(scene).toHaveAttribute('class', className);
    expect(scene).toHaveAttribute('src', expect.stringContaining('riverside.jpg'));
    expect(scene).toHaveAttribute('alt', '');
    expect(scene).toHaveAttribute('aria-hidden', 'true');
    expect(scene).toHaveAttribute('width', '1376');
    expect(scene).toHaveAttribute('height', '768');
  });
});
