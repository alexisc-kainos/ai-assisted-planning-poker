import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, DEFAULT_DECK, WS_URL } from './config';
import { isCreator } from './room';
import type { RoomState, RoomStatus, ServerMessage } from './types';

export type JoinStatus = 'idle' | 'checking' | 'connecting' | 'joined' | 'reconnecting' | 'full' | 'error';

const RECONNECT_DELAY_MS = 2_000;

export async function fetchRoomStatus(roomId: string): Promise<RoomStatus> {
  const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(roomId)}`);
  if (!res.ok) throw new Error(`Room status request failed: ${res.status}`);
  return res.json();
}

export function useRoom(roomId: string) {
  const [status, setStatus] = useState<JoinStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(
    (name: string, avatar: string) => {
      const params = new URLSearchParams({ room: roomId, name, avatar });
      if (isCreator(roomId)) params.set('deck', DEFAULT_DECK);

      const ws = new WebSocket(`${WS_URL}/ws?${params}`);
      socketRef.current = ws;
      let welcomed = false;

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'welcome') {
          welcomed = true;
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
        if (!welcomed) {
          setStatus('error');
          setError("Couldn't join — the room may be full or unavailable. Please try again.");
        } else if (event.code === 1001) {
          setStatus('reconnecting');
          reconnectTimer.current = setTimeout(() => connect(name, avatar), RECONNECT_DELAY_MS);
        } else {
          setStatus('error');
          setError('You were disconnected from the room. Join again to continue.');
        }
        setState(null);
        setUserId(null);
      };
    },
    [roomId],
  );

  const join = useCallback(
    async (name: string, avatar: string) => {
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
      if (roomStatus.full) {
        setCapacity(roomStatus.capacity);
        setStatus('full');
        return;
      }
      setStatus('connecting');
      connect(name, avatar);
    },
    [roomId, connect],
  );

  useEffect(
    () => () => {
      clearTimeout(reconnectTimer.current);
      const ws = socketRef.current;
      socketRef.current = null;
      ws?.close();
    },
    [],
  );

  return { status, error, capacity, userId, state, join };
}
