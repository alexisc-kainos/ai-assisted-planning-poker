import { describe, expect, it } from 'vitest';
import { generateRoomId, isCreator, isValidRoomId, joinUrl, markCreator } from '../room';
import { nameError } from '../validation';

describe('nameError', () => {
  it.each(['', '   ', '\t'])('requires a name (%j)', (name) => {
    expect(nameError(name)).toBe('Name is required');
  });

  it('rejects names over 32 characters after trimming', () => {
    expect(nameError('x'.repeat(33))).toBe('Name must be 32 characters or fewer');
    expect(nameError(`  ${'x'.repeat(32)}  `)).toBeNull();
  });

  it('accepts a normal name', () => {
    expect(nameError('Alice')).toBeNull();
  });
});

describe('room ids', () => {
  it('generates ids that satisfy the backend contract', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = generateRoomId();
      expect(id).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(isValidRoomId(id)).toBe(true);
    }
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, generateRoomId));
    expect(ids.size).toBe(50);
  });

  it.each([null, '', 'ABCD', 'abc', 'abcd-', 'abcd efgh'])('rejects %j', (id) => {
    expect(isValidRoomId(id)).toBe(false);
  });

  it('builds a join url with the room query param', () => {
    const location = { origin: 'https://team.github.io', pathname: '/poker/' } as Location;
    expect(joinUrl('xk29-4plm', location)).toBe('https://team.github.io/poker/?room=xk29-4plm');
  });

  it('remembers which rooms this tab created', () => {
    expect(isCreator('xk29-4plm')).toBe(false);
    markCreator('xk29-4plm');
    expect(isCreator('xk29-4plm')).toBe(true);
  });
});
