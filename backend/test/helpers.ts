import { once } from 'node:events';
import WebSocket from 'ws';
import { loadConfig, type Config } from '../src/config.js';
import { createAppServer, type AppServer } from '../src/server.js';

export type Message = any;

export async function startServer(overrides: Partial<Config> = {}): Promise<{ app: AppServer; port: number }> {
  const app = createAppServer({ ...loadConfig({}), ...overrides });
  const port = await app.listen(0);
  return { app, port };
}

export class TestClient {
  readonly messages: Message[] = [];
  private waiters: Array<() => void> = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()));
      this.waiters.splice(0).forEach((wake) => wake());
    });
  }

  async next(type?: string, timeoutMs = 2_000): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.messages.findIndex((m) => !type || m.type === type);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${type ?? 'message'}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  /** Waits for the latest state, skipping any intermediate snapshots. */
  async settledState(): Promise<Message> {
    let state = await this.next('state');
    await new Promise((resolve) => setTimeout(resolve, 30));
    while (this.messages.some((m) => m.type === 'state')) state = await this.next('state');
    return state;
  }

  send(message: unknown): void {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = once(this.ws, 'close');
    this.ws.close();
    await closed;
  }
}

const wsUrl = (port: number, params: Record<string, string>) =>
  `ws://127.0.0.1:${port}/ws?${new URLSearchParams(params)}`;

export async function connect(
  port: number,
  params: Record<string, string>,
  options: WebSocket.ClientOptions = {},
): Promise<TestClient> {
  const ws = new WebSocket(wsUrl(port, params), options);
  const client = new TestClient(ws);
  await once(ws, 'open');
  return client;
}

export function rejectedStatus(port: number, params: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(port, params));
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('open', () => {
      ws.close();
      reject(new Error('Expected upgrade to be rejected'));
    });
    ws.on('error', () => undefined);
  });
}
