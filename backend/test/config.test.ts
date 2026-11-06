import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('keep-awake configuration', () => {
  it('defaults the room keep-awake duration to 90 minutes', () => {
    expect(loadConfig({}).roomKeepAwakeDurationMs).toBe(90 * 60 * 1_000);
  });

  it('loads a configurable room duration and Render URL', () => {
    const config = loadConfig({
      ROOM_KEEP_AWAKE_DURATION_MS: '3600000',
      RENDER_EXTERNAL_URL: 'https://planning-poker.onrender.com/',
    });

    expect(config.roomKeepAwakeDurationMs).toBe(60 * 60 * 1_000);
    expect(config.renderExternalUrl).toBe('https://planning-poker.onrender.com');
  });

  it.each(['0', '-1', 'invalid', '1.5'])('rejects invalid room duration %s', (value) => {
    expect(() => loadConfig({ ROOM_KEEP_AWAKE_DURATION_MS: value })).toThrow(
      'Invalid ROOM_KEEP_AWAKE_DURATION_MS',
    );
  });

  it.each(['not a URL', 'ftp://planning-poker.onrender.com'])('rejects invalid Render URL %s', (value) => {
    expect(() => loadConfig({ RENDER_EXTERNAL_URL: value })).toThrow(
      'Invalid RENDER_EXTERNAL_URL: expected an absolute HTTP(S) URL',
    );
  });
});
