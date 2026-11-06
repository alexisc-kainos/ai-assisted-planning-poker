import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeepAwake } from '../src/keepAwake.js';

const TEN_MINUTES = 10 * 60 * 1_000;
const NINETY_MINUTES = 90 * 60 * 1_000;

let keepAwake: KeepAwake | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
});

afterEach(() => {
  keepAwake?.shutdown();
  keepAwake = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('KeepAwake', () => {
  it('pings on the fixed cadence and stops at the room deadline', async () => {
    keepAwake = new KeepAwake('https://planning-poker.onrender.com', NINETY_MINUTES);
    keepAwake.roomCreated('room-one');

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - 1);
    expect(fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).pathname).toBe('/health');

    await vi.advanceTimersByTimeAsync(NINETY_MINUTES - TEN_MINUTES);
    expect(fetch).toHaveBeenCalledTimes(8);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it('stops pinging when a room closes before its deadline', async () => {
    keepAwake = new KeepAwake('https://planning-poker.onrender.com', NINETY_MINUTES);
    keepAwake.roomCreated('room-two');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

    keepAwake.roomClosed('room-two');
    await vi.advanceTimersByTimeAsync(20 * 60 * 1_000);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('continues for a later room after the earlier room expires', async () => {
    keepAwake = new KeepAwake('https://planning-poker.onrender.com', NINETY_MINUTES);
    keepAwake.roomCreated('room-three');
    await vi.advanceTimersByTimeAsync(8 * 60 * 1_000);
    keepAwake.roomCreated('room-four');

    await vi.advanceTimersByTimeAsync(NINETY_MINUTES);
    expect(fetch).toHaveBeenCalledTimes(9);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it('does not ping when no public URL is configured', async () => {
    keepAwake = new KeepAwake(undefined, NINETY_MINUTES);
    keepAwake.roomCreated('room-five');

    await vi.advanceTimersByTimeAsync(NINETY_MINUTES + TEN_MINUTES);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('logs a failed request and retries without extending the deadline', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', request);
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    keepAwake = new KeepAwake('https://planning-poker.onrender.com', NINETY_MINUTES);
    keepAwake.roomCreated('room-six');

    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(logError).toHaveBeenCalledWith('Keep-awake health request failed', expect.any(Error));
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(NINETY_MINUTES - 2 * TEN_MINUTES);
    expect(request).toHaveBeenCalledTimes(8);
  });

  it('stops its timer and aborts a pending request on shutdown', async () => {
    const request = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', request);
    keepAwake = new KeepAwake('https://planning-poker.onrender.com', NINETY_MINUTES);
    keepAwake.roomCreated('room-seven');

    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(request).toHaveBeenCalledOnce();

    const signal = request.mock.calls[0][1]?.signal;
    keepAwake.shutdown();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(request).toHaveBeenCalledOnce();
  });
});
