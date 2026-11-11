export const MAX_NAME_LENGTH = 32;
export const MAX_TICKET_TITLE_LENGTH = 100;
export const MAX_TICKET_DESCRIPTION_LENGTH = 500;
export const MAX_TICKETS = 10;
export const MAX_JIRA_TITLE_LENGTH = 255;
export const MAX_JIRA_EDIT_TEXT_LENGTH = 50_000;

const normaliseName = (name: string): string => name.trim().toLowerCase();

export function findMember<T extends { name: string }>(members: readonly T[], name: string): T | undefined {
  const wanted = normaliseName(name);
  return members.find((member) => normaliseName(member.name) === wanted);
}

export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required';
  if (Array.from(trimmed).length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} characters or fewer`;
  return null;
}

export function ticketTitleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return 'Title is required';
  if (Array.from(trimmed).length > MAX_TICKET_TITLE_LENGTH) return `Title must be ${MAX_TICKET_TITLE_LENGTH} characters or fewer`;
  if (/[\r\n\u2028\u2029]/.test(trimmed)) return 'Title must not contain line breaks';
  return null;
}

export function ticketDescriptionError(description: string): string | null {
  if (Array.from(description.trim()).length > MAX_TICKET_DESCRIPTION_LENGTH) {
    return `Description must be ${MAX_TICKET_DESCRIPTION_LENGTH} characters or fewer`;
  }
  return null;
}

export function jiraTitleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return 'Title is required';
  if (Array.from(trimmed).length > MAX_JIRA_TITLE_LENGTH) return `Title must be ${MAX_JIRA_TITLE_LENGTH} characters or fewer`;
  if (/[\r\n\u2028\u2029]/.test(trimmed)) return 'Title must not contain line breaks';
  return null;
}

export function jiraEditTextError(text: string): string | null {
  if (Array.from(text.trim()).length > MAX_JIRA_EDIT_TEXT_LENGTH) return `Must be ${MAX_JIRA_EDIT_TEXT_LENGTH} characters or fewer`;
  return null;
}
