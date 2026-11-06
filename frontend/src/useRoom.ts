import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, DEFAULT_DECK, WS_URL } from './config';
import { clearSession, isCreator, loadSession, saveSession } from './room';
import type {
  ClientMessage,
  RoomMemberName,
  RoomState,
  RoomStatus,
  ServerMessage,
  TicketFields,
  TicketType,
} from './types';
import { findMember } from './validation';

export type JoinStatus =
  | 'idle'
  | 'checking'
  | 'connecting'
  | 'rejoining'
  | 'joined'
  | 'reconnecting'
  | 'replaced'
  | 'full'
  | 'error';

const SESSION_EXPIRED = 4001;
const REPLACED = 4002;

const MEMBER_REFRESH_INTERVAL_MS = 5_000;
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
// 2+4+8+16+30+30s covers a Render free-tier cold start.
export const MAX_RECONNECT_ATTEMPTS = 6;

export const reconnectDelay = (attempt: number) =>
  Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);

export async function fetchRoomStatus(roomId: string): Promise<RoomStatus> {
  const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(roomId)}`);
  if (!res.ok) throw new Error(`Room status request failed: ${res.status}`);
  return res.json();
}

type Credentials = { token: string } | { name: string; avatar: string } | { name: string; takeover: true };

const JOIN_FAILED = "Couldn't join — the room may be full or unavailable. Please try again.";

export function useRoom(roomId: string) {
  const [status, setStatus] = useState<JoinStatus>(() => (loadSession(roomId) ? 'rejoining' : 'idle'));
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [members, setMembers] = useState<RoomMemberName[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshMembers = useCallback(async (): Promise<RoomMemberName[] | null> => {
    try {
      const latest = (await fetchRoomStatus(roomId)).members ?? [];
      setMembers(latest);
      return latest;
    } catch {
      return null;
    }
  }, [roomId]);

  const connect = useCallback(
    (credentials: Credentials, reconnectAttempt: number | null = null) => {
      const params = new URLSearchParams({ room: roomId });
      if ('token' in credentials) {
        params.set('token', credentials.token);
      } else if ('takeover' in credentials) {
        params.set('name', credentials.name);
        params.set('takeover', '1');
      } else {
        params.set('name', credentials.name);
        params.set('avatar', credentials.avatar);
        if (isCreator(roomId)) params.set('deck', DEFAULT_DECK);
      }

      const ws = new WebSocket(`${WS_URL}/ws?${params}`);
      socketRef.current = ws;
      let welcomed = false;
      let token = 'token' in credentials ? credentials.token : null;

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'welcome') {
          welcomed = true;
          token = message.token;
          saveSession(roomId, message.token);
          setUserId(message.userId);
        } else if (message.type === 'state') {
          setState(message);
          setStatus('joined');
          setError(null);
        } else if (message.type === 'error') {
          setError(message.message);
        }
      };

      ws.onclose = (event) => {
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        setState(null);
        setUserId(null);

        const retry = (attempt: number) => {
          setStatus('reconnecting');
          const next = token ? { token } : credentials;
          reconnectTimer.current = setTimeout(() => connect(next, attempt), reconnectDelay(attempt));
        };

        if (event.code === SESSION_EXPIRED) {
          clearSession(roomId);
          setStatus('idle');
          setError(null);
          void refreshMembers();
        } else if (event.code === REPLACED) {
          setStatus('replaced');
          setError(null);
        } else if (welcomed) {
          retry(0);
        } else if (reconnectAttempt !== null && reconnectAttempt + 1 < MAX_RECONNECT_ATTEMPTS) {
          retry(reconnectAttempt + 1);
        } else if (reconnectAttempt === null && 'name' in credentials) {
          // The browser hides why the upgrade failed, so check whether the name was taken meanwhile.
          void refreshMembers().then((latest) => {
            const holder = latest && findMember(latest, credentials.name);
            if (holder && !('takeover' in credentials && holder.away)) {
              setStatus('idle');
              setError(null);
            } else {
              setStatus('error');
              setError(JOIN_FAILED);
            }
          });
        } else {
          setStatus('error');
          setError(JOIN_FAILED);
        }
      };
    },
    [roomId, refreshMembers],
  );

  const join = useCallback(
    async (name: string, avatar: string) => {
      const token = loadSession(roomId);
      if (token) {
        setStatus('rejoining');
        setError(null);
        connect({ token }, 0);
        return;
      }

      setStatus('checking');
      setError(null);
      let roomStatus: RoomStatus;
      try {
        roomStatus = await fetchRoomStatus(roomId);
      } catch {
        setStatus('error');
        setError("Couldn't reach the server. Please try again.");
        return;
      }
      const latest = roomStatus.members ?? [];
      setMembers(latest);
      if (findMember(latest, name)) {
        setStatus('idle');
        return;
      }
      if (roomStatus.full) {
        setCapacity(roomStatus.capacity);
        setStatus('full');
        return;
      }
      setStatus('connecting');
      connect({ name, avatar });
    },
    [roomId, connect],
  );

  const takeOver = useCallback(
    (name: string) => {
      setStatus('connecting');
      setError(null);
      connect({ name, takeover: true });
    },
    [connect],
  );

  const resume = useCallback(() => {
    const token = loadSession(roomId);
    if (!token) return setStatus('idle');
    setStatus('rejoining');
    connect({ token }, 0);
  }, [roomId, connect]);

  const send = useCallback((message: ClientMessage) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  const vote = useCallback((value: string, round: number) => send({ type: 'vote', value, round }), [send]);

  const reveal = useCallback(() => send({ type: 'reveal' }), [send]);

  const reset = useCallback(() => send({ type: 'reset' }), [send]);

  const addTicket = useCallback(
    (fields: TicketFields, type: TicketType) => send({ type: 'addTicket', ticket: { type, ...fields } }),
    [send],
  );

  const editTicket = useCallback(
    (ticketId: string, fields: TicketFields, ticketType: TicketType) =>
      send({ type: 'editTicket', ticketId, ...fields, ticketType }),
    [send],
  );

  const removeTicket = useCallback((ticketId: string) => send({ type: 'removeTicket', ticketId }), [send]);

  const selectTicket = useCallback((ticketId: string) => send({ type: 'selectTicket', ticketId }), [send]);

  const setSpectating = useCallback(
    (spectating: boolean) => send({ type: 'setSpectating', spectating }),
    [send],
  );

  useEffect(() => {
    const token = loadSession(roomId);
    if (token) connect({ token }, 0);
    else void refreshMembers();
    return () => {
      clearTimeout(reconnectTimer.current);
      const ws = socketRef.current;
      socketRef.current = null;
      ws?.close();
    };
  }, [roomId, connect, refreshMembers]);

  useEffect(() => {
    if (status === 'joined' || status === 'rejoining' || status === 'reconnecting' || status === 'replaced') return;
    const timer = setInterval(() => void refreshMembers(), MEMBER_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, refreshMembers]);

  return {
    status,
    error,
    capacity,
    userId,
    state,
    members,
    join,
    takeOver,
    resume,
    vote,
    reveal,
    reset,
    addTicket,
    editTicket,
    removeTicket,
    selectTicket,
    setSpectating,
  };
}
