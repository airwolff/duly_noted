import { describe, expect, it } from 'vitest';
import { buildTTokenInput, lookupTToken, parseTTokenIndex, validateTTokens } from './t-tokens.js';

describe('buildTTokenInput', () => {
  it('injects sequential [T{n}] tokens ahead of every utterance', () => {
    const out = buildTTokenInput([
      { start: 0, end: 3000, text: 'first' },
      { start: 5000, end: 8000, text: 'second' },
    ]);
    expect(out.text).toBe('[T0] first\n[T1] second');
    expect(out.lookup).toEqual([0, 5000]);
  });

  it('includes speaker label when present', () => {
    const out = buildTTokenInput([
      { start: 0, end: 1000, text: 'hello', speaker: 'A' },
      { start: 1000, end: 2000, text: 'world', speaker: 'B' },
    ]);
    expect(out.text).toBe('[T0] A: hello\n[T1] B: world');
  });

  it('returns empty text and empty lookup for empty input', () => {
    const out = buildTTokenInput([]);
    expect(out.text).toBe('');
    expect(out.lookup).toEqual([]);
  });
});

describe('parseTTokenIndex', () => {
  it('returns the integer index for a valid token', () => {
    expect(parseTTokenIndex('[T0]')).toBe(0);
    expect(parseTTokenIndex('[T42]')).toBe(42);
  });

  it('returns null for missing brackets', () => {
    expect(parseTTokenIndex('T0')).toBeNull();
    expect(parseTTokenIndex('T42')).toBeNull();
  });

  it('returns null for non-numeric body', () => {
    expect(parseTTokenIndex('[Tabc]')).toBeNull();
    expect(parseTTokenIndex('[T-1]')).toBeNull();
    expect(parseTTokenIndex('[T1.5]')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(parseTTokenIndex('[X0]')).toBeNull();
    expect(parseTTokenIndex('[T]')).toBeNull();
    expect(parseTTokenIndex('')).toBeNull();
    expect(parseTTokenIndex('[T0] extra')).toBeNull();
  });
});

describe('lookupTToken', () => {
  const lookup = [0, 5000, 10000];

  it('resolves a valid token to its ms timestamp', () => {
    expect(lookupTToken('[T0]', lookup)).toBe(0);
    expect(lookupTToken('[T2]', lookup)).toBe(10000);
  });

  it('returns null for out-of-range index', () => {
    expect(lookupTToken('[T99]', lookup)).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(lookupTToken('T0', lookup)).toBeNull();
    expect(lookupTToken('[X0]', lookup)).toBeNull();
    expect(lookupTToken('[T-1]', lookup)).toBeNull();
    expect(lookupTToken('', lookup)).toBeNull();
  });
});

describe('validateTTokens', () => {
  const lookup = [0, 5000];

  it('returns empty array when all tokens are valid', () => {
    expect(validateTTokens(['[T0]', '[T1]'], lookup)).toEqual([]);
  });

  it('returns offending tokens when out of range', () => {
    expect(validateTTokens(['[T0]', '[T99]'], lookup)).toEqual(['[T99]']);
  });

  it('returns offending tokens when malformed', () => {
    expect(validateTTokens(['[T0]', '[X0]', 'T1'], lookup)).toEqual(['[X0]', 'T1']);
  });

  it('round-trip: every token from buildTTokenInput validates against its own lookup', () => {
    const out = buildTTokenInput([
      { start: 0, end: 1000, text: 'a' },
      { start: 1000, end: 2000, text: 'b' },
      { start: 2000, end: 3000, text: 'c' },
    ]);
    const tokens = ['[T0]', '[T1]', '[T2]'];
    expect(validateTTokens(tokens, out.lookup)).toEqual([]);
  });
});
