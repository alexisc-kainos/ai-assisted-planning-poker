export interface Config {
  port: number;
  maxRoomUsers: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  shutdownGraceMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  allowedOrigins: string[];
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
  };
}
