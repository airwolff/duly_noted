import { describe, expect, it } from 'vitest';
import { selectNewVideoIds } from './discover.js';

describe('selectNewVideoIds', () => {
  it('returns ids that are not already in the existing set', () => {
    expect(selectNewVideoIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });

  it('preserves the input order', () => {
    expect(selectNewVideoIds(['c', 'a', 'b'], [])).toEqual(['c', 'a', 'b']);
  });

  it('deduplicates the fetched list', () => {
    expect(selectNewVideoIds(['a', 'a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns an empty array when every fetched id is already known', () => {
    expect(selectNewVideoIds(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('returns an empty array when the fetched list is empty', () => {
    expect(selectNewVideoIds([], ['a'])).toEqual([]);
  });
});
