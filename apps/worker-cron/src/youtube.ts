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
            })
            .passthrough(),
        })
        .passthrough(),
    ),
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
}

export interface VideoDetail {
  id: string;
  title: string;
  channelId: string;
  durationSeconds: number;
}

const ISO_DURATION_RE = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * Convert an ISO 8601 duration like "PT1H30M15S" to seconds. Hand-rolled
 * to avoid pulling in a duration library; YouTube's `videos.list` returns
 * only the time-component subset (no Y/M/W/D for video durations).
 */
export function parseIsoDuration(iso: string): number {
  const match = ISO_DURATION_RE.exec(iso);
  if (!match) {
    throw new Error(`unrecognized ISO 8601 duration: ${iso}`);
  }
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

export interface FetchPlaylistArgs {
  apiKey: string;
  uploadsPlaylistId: string;
}

/**
 * One quota unit. Returns the most recent up-to-10 uploads for the channel.
 * Uses the uploads playlist convention (UC… → UU…) so no `channels.list`
 * call is required at scan time. `search.list` is forbidden (100 units).
 */
export async function fetchUploadsPlaylistItems(args: FetchPlaylistArgs): Promise<PlaylistItem[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('playlistId', args.uploadsPlaylistId);
  url.searchParams.set('key', args.apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`youtube playlistItems.list failed: ${response.status} ${text}`);
  }
  const json: unknown = await response.json();
  const parsed = playlistItemsResponseSchema.parse(json);
  return parsed.items.map((item) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
  }));
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
  return parsed.items.map((item) => ({
    id: item.id,
    title: item.snippet.title,
    channelId: item.snippet.channelId,
    durationSeconds: parseIsoDuration(item.contentDetails.duration),
  }));
}
