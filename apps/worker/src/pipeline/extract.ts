import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const YT_DLP_BINARY = process.env.YT_DLP_PATH ?? 'yt-dlp';

/**
 * Extract opus audio from a YouTube video into the given output path. The
 * worker container ships yt-dlp at /usr/local/bin/yt-dlp via the Dockerfile.
 * Throws an Error carrying yt-dlp's stderr when the binary exits non-zero —
 * the orchestrator catches and writes it to `meetings.last_error`.
 */
export async function extractAudio(youtubeId: string, outPath: string): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  try {
    await execFileAsync(YT_DLP_BINARY, ['-x', '--audio-format', 'opus', '-o', outPath, url], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = e.stderr?.trim() || e.message || 'unknown yt-dlp failure';
    throw new Error(`yt-dlp failed for ${youtubeId}: ${detail}`);
  }
}
