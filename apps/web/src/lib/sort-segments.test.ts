import { describe, it, expect } from 'vitest';
import { sortSegments } from './sort-segments.js';

describe('sortSegments', () => {
  it('orders by sequence_order ascending', () => {
    const r = sortSegments([
      { id: 'a', sequence_order: 2 },
      { id: 'b', sequence_order: 0 },
      { id: 'c', sequence_order: 1 },
    ]);
    expect(r.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks sequence_order ties by id ascending', () => {
    const r = sortSegments([
      { id: 'z', sequence_order: 1 },
      { id: 'a', sequence_order: 1 },
      { id: 'm', sequence_order: 0 },
    ]);
    expect(r.map((s) => s.id)).toEqual(['m', 'a', 'z']);
  });

  it('does not mutate the input array', () => {
    const input = [
      { id: 'b', sequence_order: 1 },
      { id: 'a', sequence_order: 0 },
    ];
    const snap = JSON.parse(JSON.stringify(input));
    sortSegments(input);
    expect(input).toEqual(snap);
  });

  it('returns an empty array when input is empty', () => {
    expect(sortSegments([])).toEqual([]);
  });
});
