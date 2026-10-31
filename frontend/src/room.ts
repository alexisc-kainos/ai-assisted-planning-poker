const ROOM_ID_PATTERN = /^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// Largest multiple of 36 below 256, so modulo sampling stays unbiased.
const BYTE_LIMIT = 252;

function segment(length: number): string {
  let out = '';
  const bytes = new Uint8Array(1);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    if (bytes[0] < BYTE_LIMIT) out += ALPHABET[bytes[0] % ALPHABET.length];
  }
  return out;
}

export function generateRoomId(): string {
  return `${segment(4)}-${segment(4)}`;
}

export function isValidRoomId(value: string | null): value is string {
  return value !== null && value.length <= 128 && ROOM_ID_PATTERN.test(value);
}

export function joinUrl(roomId: string, location: Location = window.location): string {
  return `${location.origin}${location.pathname}?room=${roomId}`;
}

const creatorKey = (roomId: string) => `ppk:creator:${roomId}`;

export function markCreator(roomId: string): void {
  sessionStorage.setItem(creatorKey(roomId), '1');
}

export function isCreator(roomId: string): boolean {
  return sessionStorage.getItem(creatorKey(roomId)) === '1';
}
