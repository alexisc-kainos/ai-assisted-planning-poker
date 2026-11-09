import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, DEFAULT_DECK, WS_URL } from './config';
import { clearSession, isCreator, loadSession, saveSession } from './room';
import type {
  ClientMessage,
  JiraRequest,
  JiraResult,
  JiraStatus,
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
export const JIRA_REQUEST_TIMEOUT_MS = 30_000;

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
  const [jiraStatus, setJiraStatus] = useState<JiraStatus | null>(null);
  const pendingJira = useRef(new Map<string, {
    resolve: (result: JiraResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>());
  const requestSequence = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const clearJira = useCallback(() => {
    for (const pending of pendingJira.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection changed. Jira outcome may be unknown; check Jira before trying again.'));
    }
    pendingJira.current.clear();
    setJiraStatus(null);
  }, []);

  const jiraRequest = useCallback((request: JiraRequest): Promise<JiraResult> => {
    const ws = socketRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Room is not connected.'));
    const requestId = `jira-${++requestSequence.current}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingJira.current.delete(requestId);
        reject(new Error('Jira request timed out. Outcome may be unknown; check Jira before trying again.'));
      }, JIRA_REQUEST_TIMEOUT_MS);
      pendingJira.current.set(requestId, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ type: 'jira', requestId, ...request }));
      } catch {
        clearTimeout(timer);
        pendingJira.current.delete(requestId);
        reject(new Error('Could not send Jira request.'));
      }
    });
  }, []);

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
      clearJira();
      socketRef.current?.close();
      const params = new URLSearchParams({ room: roomId });
      if ('token' in credentials) {
        params.set('token', credentials.token);
      } else if ('takeover' in credentials) {
        params.set('name', credentials.name);
        params.set('takeover', '1');
      } else {
        params.set('name', credentials.name);
        params.set('avatar', credentials.avatar);
        if (isCreator(roomId)) {
          params.set('deck', DEFAULT_DECK);
          params.set('spectating', '1');
        }
      }

      const ws = new WebSocket(`${WS_URL}/ws?${params}`);
      socketRef.current = ws;
      let welcomed = false;
      let token = 'token' in credentials ? credentials.token : null;

      ws.onmessage = (event) => {
        if (socketRef.current !== ws) return;
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'jira') {
          const pending = pendingJira.current.get(message.requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          pendingJira.current.delete(message.requestId);
          if (message.data?.status) setJiraStatus(message.data.status);
          if (message.ok) pending.resolve(message.data ?? {});
          else pending.reject(new Error(`${message.data?.uncertain ? 'Jira outcome is uncertain. Check Jira before trying again. ' : ''}${message.error || 'Jira request failed.'}`));
        } else if (message.type === 'jiraStatus') {
          setJiraStatus(message.status);
        } else if (message.type === 'welcome') {
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
        } else if (message.type === 'replaced') {
          clearJira();
          // A proxy can lose the close frame and report 1006 instead of 4002.
          socketRef.current = null;
          clearTimeout(reconnectTimer.current);
          setState(null);
          setUserId(null);
          setStatus('replaced');
          setError(null);
          ws.close();
        }
      };

      ws.onclose = (event) => {
        if (socketRef.current !== ws) return;
        clearJira();
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
    [roomId, refreshMembers, clearJira],
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
    // A hidden or prerendered page must not take the session from the tab the person is using.
    const rejoinWhenShown = () => {
      if (!token || document.hidden || (document as { prerendering?: boolean }).prerendering) return;
      document.removeEventListener('visibilitychange', rejoinWhenShown);
      document.removeEventListener('prerenderingchange', rejoinWhenShown);
      connect({ token }, 0);
    };
    if (token) {
      document.addEventListener('visibilitychange', rejoinWhenShown);
      document.addEventListener('prerenderingchange', rejoinWhenShown);
      rejoinWhenShown();
    } else {
      void refreshMembers();
    }
    return () => {
      document.removeEventListener('visibilitychange', rejoinWhenShown);
      document.removeEventListener('prerenderingchange', rejoinWhenShown);
      clearTimeout(reconnectTimer.current);
      clearJira();
      const ws = socketRef.current;
      socketRef.current = null;
      ws?.close();
    };
  }, [roomId, connect, refreshMembers, clearJira]);

  const isHost = status === 'joined' && userId !== null && state?.hostId === userId;
  useEffect(() => {
    let active = true;
    if (!isHost) {
      clearJira();
      return;
    }
    void jiraRequest({ action: 'status' }).catch(() => {
      if (active) setJiraStatus({ available: false, connected: false, reason: 'Jira status unavailable.' });
    });
    return () => { active = false; };
  }, [isHost, jiraRequest, clearJira]);

  useEffect(() => {
    if (status === 'joined' || status === 'rejoining' || status === 'reconnecting' || status === 'replaced') return;
    const timer = setInterval(() => void refreshMembers(), MEMBER_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, refreshMembers]);

  return {
    status,
    jiraStatus,
    jiraRequest,
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
