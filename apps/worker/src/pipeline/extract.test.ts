import { describe, expect, it } from 'vitest';
import {
  buildTranscodeArgs,
  buildYtDlpArgs,
  isBlockedByYouTube,
  withProxySession,
} from './extract.js';

const OUT = '/tmp/duly-noted-x/meeting.opus';
const URL = 'https://www.youtube.com/watch?v=abc123';

describe('buildYtDlpArgs', () => {
  it('emits the SPEC §Stage 2 extraction command when no proxy is configured', () => {
    expect(buildYtDlpArgs(URL, OUT, undefined)).toEqual([
      '-f',
      'worstaudio[acodec=opus]/worstaudio',
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
      '-f',
      'worstaudio[acodec=opus]/worstaudio',
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

describe('withProxySession', () => {
  it('replaces the ProxyWing session id and keeps the other username suffixes', () => {
    const out = withProxySession(
      'http://acct-country-us-session-abc123:secret@gw.proxywing.example:8080',
      'ff00ee11',
    );
    expect(out).toContain('acct-country-us-session-ff00ee11:secret@');
    expect(out).toContain('gw.proxywing.example:8080');
  });

  it('handles a session suffix that is not last in the username', () => {
    const out = withProxySession(
      'http://acct-session-abc123-country-us:secret@gw.proxywing.example:8080',
      'ff00ee11',
    );
    expect(out).toContain('acct-session-ff00ee11-country-us:secret@');
  });

  it('returns a proxy url without a session suffix unchanged', () => {
    const plain = 'http://user:pass@gw.proxywing.example:8080';
    expect(withProxySession(plain, 'ff00ee11')).toBe(plain);
  });
});

describe('isBlockedByYouTube', () => {
  it.each([
    'ERROR: unable to download video data: HTTP Error 403: Forbidden',
    'WARNING: Unable to download webpage: HTTP Error 429: Too Many Requests',
    'ERROR: [youtube] abc: Sign in to confirm you’re not a bot.',
  ])('treats %s as a block worth retrying', (detail) => {
    expect(isBlockedByYouTube(detail)).toBe(true);
  });

  it('does not retry a video that is simply gone', () => {
    expect(isBlockedByYouTube('ERROR: [youtube] abc: Video unavailable')).toBe(false);
  });
});

describe('buildTranscodeArgs', () => {
  it('re-encodes to mono 24 kbps opus so long meetings fit the 50 MB Storage limit', () => {
    const args = buildTranscodeArgs('/tmp/in.source.opus', OUT);
    expect(args).toEqual(
      expect.arrayContaining(['-ac', '1', '-c:a', 'libopus', '-b:a', '24k', '-vbr', 'constrained']),
    );
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('/tmp/in.source.opus'));
    expect(args.at(-1)).toBe(OUT);
  });
});
