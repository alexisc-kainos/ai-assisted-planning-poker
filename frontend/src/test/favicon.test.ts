import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendDir = resolve(__dirname, '../..');
const html = new DOMParser().parseFromString(readFileSync(resolve(frontendDir, 'index.html'), 'utf8'), 'text/html');

describe('favicon', () => {
  it.each([
    ['icon', '/favicon.ico', '16x16 32x32'],
    ['icon', '/favicon-32x32.png', '32x32'],
    ['icon', '/favicon-16x16.png', '16x16'],
    ['apple-touch-icon', '/apple-touch-icon.png', '180x180'],
  ])('links %s %s from index.html and ships it in public/', (rel, href, sizes) => {
    const link = html.head.querySelector(`link[rel="${rel}"][href="${href}"]`);
    expect(link).not.toBeNull();
    expect(link?.getAttribute('sizes')).toBe(sizes);
    expect(existsSync(resolve(frontendDir, 'public', href.slice(1)))).toBe(true);
  });
});
