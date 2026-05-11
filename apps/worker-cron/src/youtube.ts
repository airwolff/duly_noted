import { z } from 'zod';

const playlistItemsResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          snippet: z
            .object({
              resourceId: z.object({ videoId: z.string() }).passthrough(),
              title: z.string(),
              publishedAt: z.string(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
    nextPageToken: z.string().optional(),
  })
  .passthrough();

const videosResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          snippet: z
            .object({
              title: z.string(),
              channelId: z.string(),
            })
            .passthrough(),
          contentDetails: z
            .object({
              duration: z.string(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export interface PlaylistItem {
  videoId: string;
  title: string;
  publishedAt: string;
}

export interface VideoDetail {
  id: string;
  title: string;
  channelId: string;
  durationSeconds: number;
}

const ISO_DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

// `D` is required because YouTube's videos.list returns `P0D` for live,
// premiere, and processing-state content. Y/M-before-T/W are unsupported:
// YouTube doesn't produce them for video durations, and converting calendar
// units to seconds would require an arbitrary day-count approximation.
export function parseIsoDuration(iso: string): number {
  const match = ISO_DURATION_RE.exec(iso);
  if (!match) {
    throw new Error(`unrecognized ISO 8601 duration: ${iso}`);
  }
  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  const seconds = match[4] ? parseInt(match[4], 10) : 0;
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export interface FetchPlaylistArgs {
  apiKey: string;
  uploadsPlaylistId: string;
  // Items with snippet.publishedAt before this cutoff are skipped and end
  // pagination for the board. YouTube returns playlistItems most-recent-first,
  // so the first stale item guarantees every later item is also stale.
  cutoffAt: Date;
}

/**
 * One quota unit per page. Pages through the uploads playlist most-recent-first
 * and short-circuits on the first item older than `cutoffAt`. Uses the uploads
 * playlist convention (UC… → UU…) so no `channels.list` call is required.
 * `search.list` is forbidden (100 units).
 */
export async function fetchUploadsPlaylistItems(args: FetchPlaylistArgs): Promise<PlaylistItem[]> {
  const collected: PlaylistItem[] = [];
  let pageToken: string | undefined;

  while (true) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('playlistId', args.uploadsPlaylistId);
    url.searchParams.set('key', args.apiKey);
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`youtube playlistItems.list failed: ${response.status} ${text}`);
    }
    const json: unknown = await response.json();
    const parsed = playlistItemsResponseSchema.parse(json);

    let hitCutoff = false;
    for (const item of parsed.items) {
      if (new Date(item.snippet.publishedAt) < args.cutoffAt) {
        hitCutoff = true;
        break;
      }
      collected.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt,
      });
    }

    if (hitCutoff || !parsed.nextPageToken) {
      return collected;
    }
    pageToken = parsed.nextPageToken;
  }
}

export interface FetchVideoDetailsArgs {
  apiKey: string;
  videoIds: string[];
}

/**
 * One quota unit. Batched up to 50 ids per call (YouTube's `id` parameter
 * cap). Returns title, channelId, and parsed duration in seconds.
 */
export async function fetchVideoDetails(args: FetchVideoDetailsArgs): Promise<VideoDetail[]> {
  if (args.videoIds.length === 0) {
    return [];
  }
  if (args.videoIds.length > 50) {
    throw new Error(
      `fetchVideoDetails called with ${args.videoIds.length} ids; YouTube videos.list caps at 50`,
    );
  }
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'contentDetails,snippet');
  url.searchParams.set('id', args.videoIds.join(','));
  url.searchParams.set('key', args.apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`youtube videos.list failed: ${response.status} ${text}`);
  }
  const json: unknown = await response.json();
  const parsed = videosResponseSchema.parse(json);
  // Per-video parse errors are logged and skipped; one bad duration must
  // not fail the board scan or exit the cron nonzero.
  return parsed.items
    .map((item): VideoDetail | null => {
      try {
        return {
          id: item.id,
          title: item.snippet.title,
          channelId: item.snippet.channelId,
          durationSeconds: parseIsoDuration(item.contentDetails.duration),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `youtube videos.list: skipping videoId=${item.id} duration=${item.contentDetails.duration} (${message})`,
        );
        return null;
      }
    })
    .filter((d): d is VideoDetail => d !== null);
}
