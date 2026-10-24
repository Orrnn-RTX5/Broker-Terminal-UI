import { describe, expect, it } from 'vitest';
import { readPositionStateVersion } from './positionStateVersion';
import { isOlderPositionVersion } from './positionStream';
import { getPositionStreamVersion } from './tradePositionStream';

describe('position state_version', () => {
  it.each([
    [3, '3'],
    ['3', '3'],
    ['03', '3'],
    [' 3 ', '3'],
    [0, '0'],
    ['0', '0'],
    ['007', '7'],
  ])('normalises %j to %j', (input, expected) => {
    expect(readPositionStateVersion(input)).toBe(expected);
  });

  it.each([[undefined], [null], ['abc'], [''], ['3.5'], [-1], [3.5], [Number.NaN], [{}], [true]])(
    'reads %j as unversioned, never as a number',
    (input) => {
      expect(readPositionStateVersion(input)).toBeNull();
    },
  );

  it('orders the numeric 3 above a stored "2", and "3" equal to 3', () => {
    expect(isOlderPositionVersion({ state_version: '2' }, { state_version: 3 })).toBe(true);
    expect(isOlderPositionVersion({ state_version: 3 }, { state_version: '2' })).toBe(false);
    expect(isOlderPositionVersion({ state_version: '3' }, { state_version: 3 })).toBe(false);
    expect(isOlderPositionVersion({ state_version: 3 }, { state_version: '3' })).toBe(false);
  });

  it('a non-numeric version is never newer or older and never throws', () => {
    expect(() => isOlderPositionVersion({ state_version: 'abc' }, { state_version: '2' })).not.toThrow();
    expect(isOlderPositionVersion({ state_version: 'abc' }, { state_version: '2' })).toBe(false);
    expect(isOlderPositionVersion({ state_version: '2' }, { state_version: 'abc' })).toBe(false);
    expect(getPositionStreamVersion({ state_version: 'abc' })).toBeNull();
  });

  it('the stream read gives one canonical string for the numeric and the string form', () => {
    expect(getPositionStreamVersion({ state_version: 3 })).toBe('3');
    expect(getPositionStreamVersion({ state_version: '3' })).toBe('3');
    expect(getPositionStreamVersion({ state_version_text: '3', state_version: 2 })).toBe('3');
  });
});
