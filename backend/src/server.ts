import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Config } from './config.js';
import { Room } from './rooms.js';
import { isValidRoomId, parseClientMessage, parseConnectParams, type ConnectParams } from './validation.js';

interface Connection {
  room: Room;
  userId: string;
  windowStart: number;
  messageCount: number;
  pongTimer?: NodeJS.Timeout;
}

export interface AppServer {
  listen(port?: number): Promise<number>;
  shutdown(): Promise<void>;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseRequestUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

export function createAppServer(config: Config): AppServer {
  const rooms = new Map<string, Room>();
  const roomSockets = new Map<string, Map<string, WebSocket>>();
  const connections = new Map<WebSocket, Connection>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  let shuttingDown = false;
  let onAllClosed: (() => void) | undefined;

  const send = (ws: WebSocket, message: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const broadcast = (room: Room) => {
    for (const [userId, ws] of roomSockets.get(room.id) ?? []) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(room.snapshot(userId)));
    }
  };

  const isRateLimited = (conn: Connection): boolean => {
    const now = Date.now();
    if (now - conn.windowStart >= config.rateLimitWindowMs) {
      conn.windowStart = now;
      conn.messageCount = 0;
    }
    conn.messageCount += 1;
    return conn.messageCount > config.rateLimitMax;
  };

  const handleMessage = (ws: WebSocket, data: RawData) => {
    const conn = connections.get(ws);
    if (!conn) return;
    if (isRateLimited(conn)) return send(ws, { type: 'error', message: 'Rate limit exceeded' });

    try {
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) return send(ws, { type: 'error', message: parsed.error });

      const { message } = parsed;
      let error: string | null;
      switch (message.type) {
        case 'vote':
          error = conn.room.vote(conn.userId, message.value);
          break;
        case 'reveal':
          error = conn.room.reveal(conn.userId);
          break;
        case 'reset':
          error = conn.room.reset(conn.userId);
          break;
        case 'setTicket':
          error = conn.room.setTicket(conn.userId, message.ticket);
          break;
      }

      if (error) send(ws, { type: 'error', message: error });
      else broadcast(conn.room);
    } catch {
      send(ws, { type: 'error', message: 'Internal error' });
    }
  };

  const handleClose = (ws: WebSocket) => {
    const conn = connections.get(ws);
    if (!conn) return;
    connections.delete(ws);
    clearTimeout(conn.pongTimer);

    const { room, userId } = conn;
    room.remove(userId);
    roomSockets.get(room.id)?.delete(userId);
    if (room.size === 0) {
      rooms.delete(room.id);
      roomSockets.delete(room.id);
    } else {
      broadcast(room);
    }
    if (connections.size === 0) onAllClosed?.();
  };

  const handleConnection = (ws: WebSocket, params: ConnectParams) => {
    let room = rooms.get(params.room);
    if (room && room.size >= config.maxRoomUsers) {
      ws.close(1008, 'room_full');
      return;
    }
    if (!room) {
      room = new Room(params.room, params.deck);
      rooms.set(room.id, room);
      roomSockets.set(room.id, new Map());
    }

    const member = room.add(params.name, params.avatar);
    roomSockets.get(room.id)?.set(member.id, ws);
    connections.set(ws, { room, userId: member.id, windowStart: Date.now(), messageCount: 0 });

    ws.on('message', (data) => handleMessage(ws, data));
    ws.on('pong', () => {
      const conn = connections.get(ws);
      if (conn) {
        clearTimeout(conn.pongTimer);
        conn.pongTimer = undefined;
      }
    });
    ws.on('close', () => handleClose(ws));
    ws.on('error', () => ws.terminate());

    send(ws, { type: 'welcome', userId: member.id });
    broadcast(room);
  };

  const applyCors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }
    res.setHeader('Vary', 'Origin');
  };

  const handleRoomStatus = (req: IncomingMessage, res: ServerResponse, rawId: string) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

    let roomId: string;
    try {
      roomId = decodeURIComponent(rawId);
    } catch {
      return sendJson(res, 400, { error: 'Invalid room id' });
    }
    if (!isValidRoomId(roomId)) return sendJson(res, 400, { error: 'Invalid room id' });

    const userCount = rooms.get(roomId)?.size ?? 0;
    sendJson(res, 200, {
      exists: rooms.has(roomId),
      userCount,
      capacity: config.maxRoomUsers,
      full: userCount >= config.maxRoomUsers,
    });
  };

  const server = createServer((req, res) => {
    const url = parseRequestUrl(req);
    if (!url) return sendJson(res, 400, { error: 'Bad request' });
    const { pathname } = url;
    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    const roomMatch = /^\/rooms\/([^/]+)$/.exec(pathname);
    if (roomMatch) return handleRoomStatus(req, res, roomMatch[1]);
    sendJson(res, 404, { error: 'Not found' });
  });

  server.on('upgrade', (req, socket, head) => {
    if (shuttingDown) return rejectUpgrade(socket, 503, 'Service Unavailable');
    const url = parseRequestUrl(req);
    if (!url) return rejectUpgrade(socket, 400, 'Bad Request');
    if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');

    const params = parseConnectParams(url.searchParams);
    if (!params) return rejectUpgrade(socket, 400, 'Bad Request');
    const existing = rooms.get(params.room);
    if (existing && existing.size >= config.maxRoomUsers) return rejectUpgrade(socket, 403, 'Forbidden');

    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, params));
  });

  const heartbeat = setInterval(() => {
    for (const [ws, conn] of connections) {
      if (conn.pongTimer) continue;
      conn.pongTimer = setTimeout(() => {
        ws.close(1011, 'heartbeat_timeout');
        setTimeout(() => ws.terminate(), 1_000).unref();
      }, config.heartbeatTimeoutMs);
      ws.ping();
    }
    for (const [id, room] of rooms) {
      if (room.size === 0) {
        rooms.delete(id);
        roomSockets.delete(id);
      }
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref();

  return {
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => resolve((server.address() as AddressInfo).port));
      });
    },

    async shutdown() {
      shuttingDown = true;
      clearInterval(heartbeat);
      for (const ws of connections.keys()) ws.close(1001, 'server_shutdown');

      await new Promise<void>((resolve) => {
        if (connections.size === 0) return resolve();
        const timer = setTimeout(resolve, config.shutdownGraceMs);
        onAllClosed = () => {
          clearTimeout(timer);
          resolve();
        };
      });

      for (const ws of connections.keys()) ws.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
