import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';
import { fetchUploadsPlaylistItems, fetchVideoDetails, type VideoDetail } from './youtube.js';

export interface DiscoverableBoard {
  id: string;
  youtube_channel_id: string | null;
  uploads_playlist_id: string | null;
}

export interface DiscoverOutcome {
  boardId: string;
  inserted: number;
  promoted: number;
  skippedReason?: string;
}

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

export interface DiscoverDeps {
  supabase: SupabaseClient<Database>;
  apiKey: string;
}

export async function discoverForBoard(
  deps: DiscoverDeps,
  board: DiscoverableBoard,
): Promise<DiscoverOutcome> {
  if (!board.youtube_channel_id || !board.uploads_playlist_id) {
    return { boardId: board.id, inserted: 0, promoted: 0, skippedReason: 'no youtube_channel_id' };
  }

  const items = await fetchUploadsPlaylistItems({
    apiKey: deps.apiKey,
    uploadsPlaylistId: board.uploads_playlist_id,
  });

  const fetchedIds = items.map((i) => i.videoId);
  if (fetchedIds.length === 0) {
    const promoted = await runAutoPromote(deps.supabase, board.id);
    return { boardId: board.id, inserted: 0, promoted };
  }

  const { data: existing, error: existingErr } = await deps.supabase
    .from('meetings')
    .select('youtube_id')
    .eq('board_id', board.id)
    .in('youtube_id', fetchedIds);
  if (existingErr) {
    throw new Error(`existing-meetings query failed: ${existingErr.message}`);
  }
  const existingIds = (existing ?? [])
    .map((row) => row.youtube_id)
    .filter((id): id is string => id !== null);
  const newIds = selectNewVideoIds(fetchedIds, existingIds);

  let inserted = 0;
  if (newIds.length > 0) {
    const details: VideoDetail[] = await fetchVideoDetails({
      apiKey: deps.apiKey,
      videoIds: newIds,
    });
    if (details.length > 0) {
      const rows = details.map((d) => ({
        board_id: board.id,
        youtube_id: d.id,
        title: d.title,
        duration_seconds: d.durationSeconds,
        status: 'discovered' as const,
      }));
      const { error: insertErr } = await deps.supabase
        .from('meetings')
        .upsert(rows, { onConflict: 'youtube_id', ignoreDuplicates: true });
      if (insertErr) {
        throw new Error(`meetings insert failed: ${insertErr.message}`);
      }
      inserted = rows.length;
    }
  }

  const promoted = await runAutoPromote(deps.supabase, board.id);
  return { boardId: board.id, inserted, promoted };
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
