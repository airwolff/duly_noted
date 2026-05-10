import { describe, it, expect } from 'vitest';
import { sanitizeRedirectTo } from './redirect-to.js';

describe('sanitizeRedirectTo', () => {
  it('returns the path unchanged for absolute same-origin paths', () => {
    expect(sanitizeRedirectTo('/midcoast-villager/lincolnville')).toBe(
      '/midcoast-villager/lincolnville',
    );
  });

  it('returns "/" for null or empty', () => {
    expect(sanitizeRedirectTo(null)).toBe('/');
    expect(sanitizeRedirectTo(undefined)).toBe('/');
    expect(sanitizeRedirectTo('')).toBe('/');
  });

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeRedirectTo('//evil.example.com/x')).toBe('/');
  });

  it('rejects absolute URLs', () => {
    expect(sanitizeRedirectTo('https://evil.example.com/x')).toBe('/');
    expect(sanitizeRedirectTo('http://evil.example.com/x')).toBe('/');
  });

  it('rejects values not starting with "/"', () => {
    expect(sanitizeRedirectTo('foo/bar')).toBe('/');
    expect(sanitizeRedirectTo('javascript:alert(1)')).toBe('/');
  });

  it('preserves query strings on same-origin paths', () => {
    expect(sanitizeRedirectTo('/foo?bar=baz')).toBe('/foo?bar=baz');
  });
});
