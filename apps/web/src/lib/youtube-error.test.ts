import { describe, it, expect } from 'vitest';
import { isFallbackErrorCode } from './youtube-error.js';

describe('isFallbackErrorCode', () => {
  it.each([100, 101, 150, 153])('is true for code %i', (c) => {
    expect(isFallbackErrorCode(c)).toBe(true);
  });

  it.each([2, 5, 0, -1, 999])('is false for unrelated code %i', (c) => {
    expect(isFallbackErrorCode(c)).toBe(false);
  });
});
