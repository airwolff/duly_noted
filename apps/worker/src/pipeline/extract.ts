import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const YT_DLP_BINARY = process.env.YT_DLP_PATH ?? 'yt-dlp';

/**
 * The smallest audio stream: YouTube's ~50 kbps opus (itag 249) where it
 * exists, else the smallest audio of any codec. yt-dlp's default `bestaudio`
 * is ~130 kbps, so a 2.3-hour meeting was ~130 MB through the residential
 * proxy — slow enough that downloads 403'd partway, and billed per GB.
 * Speech transcribes fine at 50 kbps; AssemblyAI resamples to 16 kHz anyway.
 */
export const AUDIO_FORMAT = 'worstaudio[acodec=opus]/worstaudio';

/**
 * Build yt-dlp's argv. Split out from `extractAudio` so the proxy wiring is
 * unit-testable without spawning the binary. `--proxy` leads because yt-dlp
 * reads global options before the target url.
 */
export function buildYtDlpArgs(url: string, outPath: string, proxyUrl?: string): string[] {
  const proxyArgs = proxyUrl ? ['--proxy', proxyUrl] : [];
  return [...proxyArgs, '-f', AUDIO_FORMAT, '-x', '--audio-format', 'opus', '-o', outPath, url];
}

/** Attempts per meeting before extraction fails the row. */
export const EXTRACT_ATTEMPTS = 3;

/**
 * Swap the ProxyWing `-session-<id>` in the proxy username for a new id, so
 * the attempt is pinned to a different exit node. The id in the
 * `YT_DLP_PROXY_URL` secret is fixed, so without this every extraction rides
 * the same node, and once YouTube flags that node every meeting 403s or gets
 * "Sign in to confirm you're not a bot" (seen 2026-10-31: 4 of 6 demo meetings
 * failed this way while 2 succeeded). A URL with no session suffix is
 * returned unchanged.
 */
export function withProxySession(proxyUrl: string, sessionId: string): string {
  const url = new URL(proxyUrl);
  if (!/-session-[^-]+/.test(url.username)) return proxyUrl;
  url.username = url.username.replace(/-session-[^-]+/, `-session-${sessionId}`);
  return url.toString();
}

/**
 * YouTube's IP-level refusals. Worth another attempt on a different exit node;
 * anything else (video removed, private, yt-dlp crash) is not.
 */
export function isBlockedByYouTube(detail: string): boolean {
  return /HTTP Error 403|HTTP Error 429|confirm you.re not a bot/i.test(detail);
}

/**
 * Extract opus audio from a YouTube video into the given output path. The
 * worker container ships yt-dlp at /usr/local/bin/yt-dlp via the Dockerfile.
 * Throws an Error carrying yt-dlp's stderr when the binary exits non-zero —
 * the orchestrator catches and writes it to `meetings.last_error`.
 *
 * `proxyUrl` routes egress through the ADR 0019 residential gateway. YouTube
 * fingerprints Render's datacenter range and answers direct requests with
 * HTTP 429 + "Sign in to confirm you're not a bot", so extraction without it
 * fails for every meeting in production.
 *
 * The proxy URL must pin a single exit IP for the whole yt-dlp run. YouTube
 * binds each `googlevideo` media URL to the IP that requested it (the URL
 * carries `&ip=<addr>`), so a gateway that rotates per request mints the URL
 * on one IP and fetches it from another, and the download 403s. ProxyWing
 * pins via username suffixes: `-session-<id>` holds one node, `-country-us`
 * keeps that node somewhere that can reach YouTube at all. Both are required;
 * without `-country-us` a session can pin to a node that fails TLS outright.
 * The suffixes live in the `YT_DLP_PROXY_URL` value, not here, so this code
 * stays vendor-agnostic — but a proxy URL without them fails at the download
 * step while metadata extraction still succeeds, which is a confusing shape.
 *
 * When YouTube refuses an attempt, the next one runs on a fresh session (see
 * `withProxySession`), up to EXTRACT_ATTEMPTS. This is a retry inside one
 * claim, like the vendor-call retries; a row that exhausts it still fails and
 * waits for a manual reset.
 */
export async function extractAudio(
  youtubeId: string,
  outPath: string,
  proxyUrl?: string,
): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  const attempts = proxyUrl ? EXTRACT_ATTEMPTS : 1;
  let detail = 'unknown yt-dlp failure';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const attemptProxy = proxyUrl
      ? withProxySession(proxyUrl, randomBytes(4).toString('hex'))
      : proxyUrl;
    try {
      await execFileAsync(YT_DLP_BINARY, buildYtDlpArgs(url, outPath, attemptProxy), {
        maxBuffer: 64 * 1024 * 1024,
      });
      return;
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      detail = e.stderr?.trim() || e.message || 'unknown yt-dlp failure';
      if (!isBlockedByYouTube(detail)) break;
      if (attempt < attempts) {
        console.warn(
          `yt-dlp blocked for ${youtubeId} (attempt ${attempt}/${attempts}); retrying on a new proxy session`,
        );
      }
    }
  }
  throw new Error(`yt-dlp failed for ${youtubeId}: ${detail}`);
}
