export const MAX_NAME_LENGTH = 32;
export const MAX_TICKET_LENGTH = 500;

export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required';
  if (Array.from(trimmed).length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} characters or fewer`;
  return null;
}

export function ticketError(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return 'Ticket text is required';
  if (Array.from(trimmed).length > MAX_TICKET_LENGTH) return `Ticket must be ${MAX_TICKET_LENGTH} characters or fewer`;
  return null;
}
