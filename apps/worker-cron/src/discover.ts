import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';
import { fetchUploadsPlaylistItems, fetchVideoDetails, type VideoDetail } from './youtube.js';
import { meetingDate } from './meeting-date.js';

export interface DiscoverableBoard {
  id: string;
  youtube_channel_id: string | null;
  uploads_playlist_id: string | null;
  ingest_since_days: number;
  title_pattern: string | null;
}

export interface DiscoverOutcome {
  boardId: string;
  inserted: number;
  refreshed: number;
  promoted: number;
  skippedReason?: string;
}

/** YouTube's `videos.list` caps the `id` parameter at 50. */
const VIDEOS_LIST_ID_CAP = 50;

/**
 * Pure set difference. Pulled out of `discoverForBoard` so it can be unit
 * tested without a fetch mock.
 */
export function selectNewVideoIds(fetchedIds: string[], existingIds: string[]): string[] {
  const existing = new Set(existingIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of fetchedIds) {
    if (existing.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Whether a video title belongs to a board. A town channel carries several
 * boards' meetings (Select Board, Planning Board, Budget Committee), and each
 * is its own board row on the same channel, so discovery keeps only the titles
 * matching the board's `title_pattern`. Without this every video on the
 * channel landed on whichever board scanned first.
 *
 * Case-insensitive to mirror the `~*` that auto_promote_for_board applies.
 * Patterns are kept to the subset JS and Postgres regexes share (plain words,
 * `|`, `^`). A board with no pattern keeps every title, as before.
 */
export function matchesBoardTitle(title: string, pattern: string | null): boolean {
  if (pattern === null) return true;
  return new RegExp(pattern, 'i').test(title);
}

export interface RefreshableRow {
  youtube_id: string | null;
  status: string;
  duration_seconds: number | null;
}

/**
 * Rows whose `duration_seconds` never landed. YouTube reports `PT0S` for a
 * video that is still streaming, and every Select Board meeting is streamed
 * live — so the hourly scan catches it mid-stream at 0 and the row is written
 * once and never revisited. `auto_promote_for_board` requires
 * `duration_seconds >= boards.min_duration_seconds`, so a 0 parks the meeting
 * at `discovered` permanently.
 *
 * Bounded to ids present in the current playlist window (the
 * `boards.ingest_since_days` horizon) so the refresh set cannot grow without
 * limit, and to `discovered` rows so a refresh never races the worker on a row
 * it has already claimed.
 */
export function selectRefreshableIds(rows: RefreshableRow[], fetchedIds: string[]): string[] {
  const inWindow = new Set(fetchedIds);
  return rows
    .filter(
      (r) =>
        r.youtube_id !== null &&
        inWindow.has(r.youtube_id) &&
        r.status === 'discovered' &&
        (r.duration_seconds === null || r.duration_seconds === 0),
    )
    .map((r) => r.youtube_id as string);
}

/** Batch ids for `videos.list`, which caps the `id` parameter at 50. */
export function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

export interface DiscoverDeps {
  supabase: SupabaseClient<Database>;
  apiKey: string;
}

export async function discoverForBoard(
  deps: DiscoverDeps,
  board: DiscoverableBoard,
): Promise<DiscoverOutcome> {
  if (!board.youtube_channel_id || !board.uploads_playlist_id) {
    return {
      boardId: board.id,
      inserted: 0,
      refreshed: 0,
      promoted: 0,
      skippedReason: 'no youtube_channel_id',
    };
  }

  const cutoffAt = new Date(Date.now() - board.ingest_since_days * 24 * 60 * 60 * 1000);
  const allItems = await fetchUploadsPlaylistItems({
    apiKey: deps.apiKey,
    uploadsPlaylistId: board.uploads_playlist_id,
    cutoffAt,
  });

  const boardItems = allItems.filter((i) => matchesBoardTitle(i.title, board.title_pattern));
  const fetchedIds = boardItems.map((i) => i.videoId);
  if (fetchedIds.length === 0) {
    const promoted = await runAutoPromote(deps.supabase, board.id);
    return { boardId: board.id, inserted: 0, refreshed: 0, promoted };
  }

  // Not scoped to this board: youtube_id is unique across meetings, and a
  // video already filed under a sibling board on the same channel must not be
  // re-inserted (the upsert would silently drop it and miscount).
  const { data: existing, error: existingErr } = await deps.supabase
    .from('meetings')
    .select('board_id, youtube_id, status, duration_seconds')
    .in('youtube_id', fetchedIds);
  if (existingErr) {
    throw new Error(`existing-meetings query failed: ${existingErr.message}`);
  }
  const existingRows = existing ?? [];
  const existingIds = existingRows
    .map((row) => row.youtube_id)
    .filter((id): id is string => id !== null);
  const newIds = selectNewVideoIds(fetchedIds, existingIds);
  const refreshIds = selectRefreshableIds(
    existingRows.filter((row) => row.board_id === board.id),
    fetchedIds,
  );

  // One videos.list call per 50 ids, covering new and stale-duration rows in
  // the same batches. Quota is 1 unit per call regardless of id count, so
  // folding the refresh in costs nothing at v1 scale.
  const details: VideoDetail[] = [];
  for (const batch of chunkIds([...newIds, ...refreshIds], VIDEOS_LIST_ID_CAP)) {
    details.push(...(await fetchVideoDetails({ apiKey: deps.apiKey, videoIds: batch })));
  }
  const detailById = new Map(details.map((d) => [d.id, d]));
  const publishedAtById = new Map(boardItems.map((i) => [i.videoId, i.publishedAt]));

  let inserted = 0;
  const newRows = newIds
    .map((id) => detailById.get(id))
    .filter((d): d is VideoDetail => d !== undefined)
    .map((d) => ({
      board_id: board.id,
      youtube_id: d.id,
      title: d.title,
      meeting_date: meetingDate(d.title, publishedAtById.get(d.id) ?? ''),
      duration_seconds: d.durationSeconds,
      status: 'discovered' as const,
    }));
  if (newRows.length > 0) {
    const { error: insertErr } = await deps.supabase
      .from('meetings')
      .upsert(newRows, { onConflict: 'youtube_id', ignoreDuplicates: true });
    if (insertErr) {
      throw new Error(`meetings insert failed: ${insertErr.message}`);
    }
    inserted = newRows.length;
  }

  const refreshed = await refreshDurations(
    deps.supabase,
    board.id,
    refreshIds,
    detailById,
    publishedAtById,
  );

  const promoted = await runAutoPromote(deps.supabase, board.id);
  return { boardId: board.id, inserted, refreshed, promoted };
}

/**
 * Write the now-known duration (and post-stream title and the date read from
 * it, which YouTube also rewrites once a live stream ends) back onto rows still at `discovered`. The
 * status predicate is repeated in the UPDATE so a row the worker claimed
 * between the SELECT and here is left alone.
 */
async function refreshDurations(
  supabase: SupabaseClient<Database>,
  boardId: string,
  refreshIds: string[],
  detailById: Map<string, VideoDetail>,
  publishedAtById: Map<string, string>,
): Promise<number> {
  let refreshed = 0;
  for (const id of refreshIds) {
    const detail = detailById.get(id);
    if (!detail || detail.durationSeconds === 0) {
      // Still live, or dropped by the per-video parse guard. Try again next scan.
      continue;
    }
    const { error } = await supabase
      .from('meetings')
      .update({
        title: detail.title,
        meeting_date: meetingDate(detail.title, publishedAtById.get(id) ?? ''),
        duration_seconds: detail.durationSeconds,
      })
      .eq('board_id', boardId)
      .eq('youtube_id', id)
      .eq('status', 'discovered');
    if (error) {
      throw new Error(`duration refresh failed for ${id}: ${error.message}`);
    }
    refreshed += 1;
  }
  return refreshed;
}

async function runAutoPromote(
  supabase: SupabaseClient<Database>,
  boardId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('auto_promote_for_board', {
    p_board_id: boardId,
  });
  if (error) {
    throw new Error(`auto_promote_for_board failed for ${boardId}: ${error.message}`);
  }
  return typeof data === 'number' ? data : 0;
}
