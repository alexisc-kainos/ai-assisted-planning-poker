const PING_INTERVAL_MS = 10 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10 * 1_000;

export interface KeepAwakeLifecycle {
  roomCreated(roomId: string): void;
  roomClosed(roomId: string): void;
  shutdown(): void;
}

export class KeepAwake implements KeepAwakeLifecycle {
  private readonly roomExpiries = new Map<string, number>();
  private interval: NodeJS.Timeout | undefined;
  private activeRequest: AbortController | undefined;
  private shuttingDown = false;

  constructor(
    private readonly publicUrl: string | undefined,
    private readonly durationMs: number,
  ) {}

  roomCreated(roomId: string): void {
    if (!this.publicUrl || this.shuttingDown) return;

    this.roomExpiries.set(roomId, Date.now() + this.durationMs);
    if (this.interval) return;

    this.interval = setInterval(() => void this.keepAwakeTick(), PING_INTERVAL_MS);
    this.interval.unref();
  }

  roomClosed(roomId: string): void {
    this.roomExpiries.delete(roomId);
    this.stopIfIdle();
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.roomExpiries.clear();
    this.stopInterval();
    this.activeRequest?.abort();
  }

  private async keepAwakeTick(): Promise<void> {
    const now = Date.now();
    for (const [roomId, expiresAt] of this.roomExpiries) {
      if (expiresAt <= now) this.roomExpiries.delete(roomId);
    }

    if (this.roomExpiries.size === 0) {
      this.stopIfIdle();
      return;
    }
    if (this.activeRequest || !this.publicUrl) return;

    const controller = new AbortController();
    this.activeRequest = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(new URL('/health', this.publicUrl), { signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Health request returned HTTP ${response.status}`);
      }
      await response.body?.cancel();
    } catch (error) {
      if (!this.shuttingDown && (timedOut || !controller.signal.aborted)) {
        console.error('Keep-awake health request failed', error);
      }
    } finally {
      clearTimeout(timeout);
      if (this.activeRequest === controller) this.activeRequest = undefined;
    }
  }

  private stopIfIdle(): void {
    if (this.roomExpiries.size > 0) return;
    this.stopInterval();
    this.activeRequest?.abort();
  }

  private stopInterval(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }
}
