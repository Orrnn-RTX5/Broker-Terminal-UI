import { describe, expect, it } from 'vitest';
import { getAuthenticatedAccountName, pickAccountDisplayName } from './accountDisplayName';

describe('account display names', () => {
  it('uses the owner name instead of the authentication username', () => {
    expect(getAuthenticatedAccountName({
      user: { name: '  Account Owner  ', username: 'owner@example.test' },
      username: 'owner@example.test',
    })).toBe('Account Owner');
  });

  it('leaves the name empty while only an email or username is available', () => {
    expect(getAuthenticatedAccountName({ user: { username: 'owner@example.test' } })).toBe('');
    expect(getAuthenticatedAccountName({ username: '200003' })).toBe('');
  });

  it('skips email labels and empty values to find a real name', () => {
    expect(pickAccountDisplayName(null, ' ', 'owner@example.test', 'Account Owner')).toBe('Account Owner');
    expect(getAuthenticatedAccountName({ user: { name: 'owner@example.test' }, name: 'Account Owner' })).toBe('Account Owner');
  });
});
