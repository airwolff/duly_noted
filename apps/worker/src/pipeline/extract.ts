import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const YT_DLP_BINARY = process.env.YT_DLP_PATH ?? 'yt-dlp';

/**
 * Build yt-dlp's argv. Split out from `extractAudio` so the proxy wiring is
 * unit-testable without spawning the binary. `--proxy` leads because yt-dlp
 * reads global options before the target url.
 */
export function buildYtDlpArgs(url: string, outPath: string, proxyUrl?: string): string[] {
  const proxyArgs = proxyUrl ? ['--proxy', proxyUrl] : [];
  return [...proxyArgs, '-x', '--audio-format', 'opus', '-o', outPath, url];
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
 */
export async function extractAudio(
  youtubeId: string,
  outPath: string,
  proxyUrl?: string,
): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  try {
    await execFileAsync(YT_DLP_BINARY, buildYtDlpArgs(url, outPath, proxyUrl), {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = e.stderr?.trim() || e.message || 'unknown yt-dlp failure';
    throw new Error(`yt-dlp failed for ${youtubeId}: ${detail}`);
  }
}
