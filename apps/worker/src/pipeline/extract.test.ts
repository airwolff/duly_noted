import { describe, expect, it } from 'vitest';
import { buildYtDlpArgs } from './extract.js';

const OUT = '/tmp/duly-noted-x/meeting.opus';
const URL = 'https://www.youtube.com/watch?v=abc123';

describe('buildYtDlpArgs', () => {
  it('emits the SPEC §Stage 2 extraction command when no proxy is configured', () => {
    expect(buildYtDlpArgs(URL, OUT, undefined)).toEqual([
      '-x',
      '--audio-format',
      'opus',
      '-o',
      OUT,
      URL,
    ]);
  });

  it('passes --proxy ahead of the url when a proxy is configured (ADR 0019)', () => {
    expect(buildYtDlpArgs(URL, OUT, 'http://user:pass@gw.proxywing.example:8080')).toEqual([
      '--proxy',
      'http://user:pass@gw.proxywing.example:8080',
      '-x',
      '--audio-format',
      'opus',
      '-o',
      OUT,
      URL,
    ]);
  });

  it('treats an empty-string proxy as unset rather than passing an empty --proxy value', () => {
    expect(buildYtDlpArgs(URL, OUT, '')).not.toContain('--proxy');
  });
});
