export interface JiraConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Config {
  port: number;
  maxRoomUsers: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  shutdownGraceMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  allowedOrigins: string[];
  roomKeepAwakeDurationMs: number;
  roomCloseGraceMs: number;
  renderExternalUrl?: string;
  jira?: JiraConfig;
}

function readJiraConfig(env: NodeJS.ProcessEnv): JiraConfig | undefined {
  const clientId = env.JIRA_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.JIRA_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.JIRA_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  try {
    const url = new URL(redirectUri);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/jira/oauth/callback') return undefined;
    return { clientId, clientSecret, redirectUri: url.href };
  } catch {
    return undefined;
  }
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer, got "${raw}"`);
  }
  return value;
}

function readPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = readInt(env, name, fallback);
  if (value === 0) {
    throw new Error(`Invalid ${name}: expected a positive integer, got "0"`);
  }
  return value;
}

function readOptionalHttpUrl(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${name}: expected an absolute HTTP(S) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid ${name}: expected an absolute HTTP(S) URL`);
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readInt(env, 'PORT', 3000),
    maxRoomUsers: readInt(env, 'MAX_ROOM_USERS', 50),
    heartbeatIntervalMs: readInt(env, 'HEARTBEAT_INTERVAL_MS', 30_000),
    heartbeatTimeoutMs: readInt(env, 'HEARTBEAT_TIMEOUT_MS', 10_000),
    shutdownGraceMs: readInt(env, 'SHUTDOWN_GRACE_MS', 20_000),
    rateLimitMax: readInt(env, 'RATE_LIMIT_MAX', 20),
    rateLimitWindowMs: readInt(env, 'RATE_LIMIT_WINDOW_MS', 10_000),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    roomKeepAwakeDurationMs: readPositiveInt(env, 'ROOM_KEEP_AWAKE_DURATION_MS', 90 * 60 * 1_000),
    roomCloseGraceMs: readInt(env, 'ROOM_CLOSE_GRACE_MS', 60_000),
    renderExternalUrl: readOptionalHttpUrl(env, 'RENDER_EXTERNAL_URL'),
    jira: readJiraConfig(env),
  };
}
