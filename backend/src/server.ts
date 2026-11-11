import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Config } from './config.js';
import { KeepAwake, type KeepAwakeLifecycle } from './keepAwake.js';
import { JiraService } from './jira.js';
import { Room, type Member } from './rooms.js';
import { isValidRoomId, parseClientMessage, parseConnectParams, type ConnectParams } from './validation.js';

interface Connection {
  room: Room;
  userId: string;
  origin?: string;
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

export function createAppServer(config: Config, keepAwakeLifecycle?: KeepAwakeLifecycle): AppServer {
  const rooms = new Map<string, Room>();
  const roomSockets = new Map<string, Map<string, WebSocket>>();
  const connections = new Map<WebSocket, Connection>();
  const closeTimers = new Map<string, NodeJS.Timeout>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const keepAwake =
    keepAwakeLifecycle ?? new KeepAwake(config.renderExternalUrl, config.roomKeepAwakeDurationMs);
  let shuttingDown = false;
  let onAllClosed: (() => void) | undefined;
  const jira = new JiraService(config.jira, (room, status) => {
    const ws = room.hostId ? roomSockets.get(room.id)?.get(room.hostId) : undefined;
    if (ws) send(ws, { type: 'jiraStatus', status });
  }, fetch, config.allowedOrigins);

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

      if (parsed.message.type === 'jira') {
        const message = parsed.message;
        void jira.action(conn.room, conn.userId, message, conn.origin).then((result) => {
          if (connections.get(ws) === conn) {
            send(ws, { type: 'jira', requestId: message.requestId, ok: true, data: result });
          }
          if (message.action === 'import' || message.action === 'agree' || message.action === 'details' || message.action === 'confirmEdit') broadcast(conn.room);
        }).catch((failure: unknown) => {
          if (connections.get(ws) !== conn) return;
          send(ws, { type: 'jira', requestId: message.requestId, ok: false,
            error: failure instanceof Error ? failure.message : 'Jira request failed' });
        });
        return;
      }

      const { message } = parsed;
      let error: string | null;
      switch (message.type) {
        case 'vote':
          error = conn.room.vote(conn.userId, message.value, message.round);
          break;
        case 'reveal':
          error = conn.room.reveal(conn.userId);
          break;
        case 'reset':
          error = conn.room.reset(conn.userId);
          break;
        case 'addTicket':
          error = conn.room.addTicket(conn.userId, message.ticket);
          break;
        case 'editTicket':
          error = conn.room.editTicket(
            conn.userId,
            message.ticketId,
            message.title,
            message.description,
            message.ticketType,
          );
          break;
        case 'removeTicket':
          error = conn.room.removeTicket(conn.userId, message.ticketId);
          break;
        case 'selectTicket':
          error = conn.room.selectTicket(conn.userId, message.ticketId);
          break;
        case 'setSpectating':
          error = conn.room.setSpectating(conn.userId, message.spectating);
          break;
      }

      if (error) send(ws, { type: 'error', message: error });
      else broadcast(conn.room);
    } catch {
      send(ws, { type: 'error', message: 'Internal error' });
    }
  };

  const cancelClose = (roomId: string) => {
    clearTimeout(closeTimers.get(roomId));
    closeTimers.delete(roomId);
  };

  const closeRoom = (roomId: string) => {
    cancelClose(roomId);
    const room = rooms.get(roomId);
    if (room) jira.clear(room);
    rooms.delete(roomId);
    roomSockets.delete(roomId);
    keepAwake.roomClosed(roomId);
  };

  const scheduleClose = (room: Room) => {
    cancelClose(room.id);
    const timer = setTimeout(() => {
      if (rooms.get(room.id) === room && room.connectedCount === 0) closeRoom(room.id);
    }, config.roomCloseGraceMs);
    timer.unref();
    closeTimers.set(room.id, timer);
  };

  const handleClose = (ws: WebSocket) => {
    const conn = connections.get(ws);
    if (!conn) return;
    connections.delete(ws);
    clearTimeout(conn.pongTimer);

    const { room, userId } = conn;
    roomSockets.get(room.id)?.delete(userId);
    room.markAway(userId);
    jira.reconcile(room);
    if (room.connectedCount === 0) scheduleClose(room);
    else broadcast(room);
    if (connections.size === 0) onAllClosed?.();
  };

  const attach = (ws: WebSocket, room: Room, member: Member) => {
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

    send(ws, { type: 'welcome', userId: member.id, token: member.token });
    broadcast(room);
  };

  const handleRejoin = (ws: WebSocket, roomId: string, token: string) => {
    const room = rooms.get(roomId);
    const member = room?.findByToken(token);
    if (!room || !member) {
      ws.on('error', () => ws.terminate());
      ws.close(4001, 'session_expired');
      return;
    }

    const previous = roomSockets.get(room.id)?.get(member.id);
    if (previous) {
      // Detach first so its close handler doesn't mark the member away.
      clearTimeout(connections.get(previous)?.pongTimer);
      connections.delete(previous);
      send(previous, { type: 'replaced' });
      previous.close(4002, 'replaced');
    }
    room.rejoin(member);
    jira.reconcile(room);
    cancelClose(room.id);
    attach(ws, room, member);
  };

  const handleTakeover = (ws: WebSocket, roomId: string, name: string) => {
    const room = rooms.get(roomId);
    const member = room?.findByName(name);
    if (!room || !member || member.connected) {
      ws.close(1008, 'name_taken');
      return;
    }
    room.takeOver(member);
    jira.reconcile(room);
    cancelClose(room.id);
    attach(ws, room, member);
  };

  const handleConnection = (ws: WebSocket, params: ConnectParams) => {
    if (params.token !== undefined) return handleRejoin(ws, params.room, params.token);
    if (params.takeover) return handleTakeover(ws, params.room, params.name);

    let room = rooms.get(params.room);
    if (room && room.size >= config.maxRoomUsers) {
      ws.close(1008, 'room_full');
      return;
    }
    if (room?.findByName(params.name)) {
      ws.close(1008, 'name_taken');
      return;
    }
    if (!room) {
      room = new Room(params.room, params.deck);
      rooms.set(room.id, room);
      roomSockets.set(room.id, new Map());
      keepAwake.roomCreated(room.id);
    }

    cancelClose(room.id);
    attach(ws, room, room.add(params.name, params.avatar, params.spectating));
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

    const room = rooms.get(roomId);
    const userCount = room?.size ?? 0;
    sendJson(res, 200, {
      exists: room !== undefined,
      userCount,
      capacity: config.maxRoomUsers,
      full: userCount >= config.maxRoomUsers,
      members: room?.memberNames() ?? [],
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
    if (pathname.startsWith('/jira/')) {
      void jira.handleHttp(req, res, url).catch(() => {
        if (!res.headersSent) sendJson(res, 400, { error: 'Jira authorisation failed or expired. Connect again from the room.' });
      });
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
    if (params.token === undefined) {
      const holder = existing?.findByName(params.name);
      if (params.takeover) {
        if (!holder || holder.connected) return rejectUpgrade(socket, 409, 'Conflict');
      } else {
        if (existing && existing.size >= config.maxRoomUsers) return rejectUpgrade(socket, 403, 'Forbidden');
        if (holder) return rejectUpgrade(socket, 409, 'Conflict');
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, params);
      const connection = connections.get(ws);
      if (connection) connection.origin = req.headers.origin;
    });
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
      if (room.connectedCount === 0 && !closeTimers.has(id)) closeRoom(id);
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
      jira.shutdown();
      clearInterval(heartbeat);
      keepAwake.shutdown();
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
      for (const timer of closeTimers.values()) clearTimeout(timer);
      closeTimers.clear();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
