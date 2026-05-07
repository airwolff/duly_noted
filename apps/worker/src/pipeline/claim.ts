import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';

export interface ClaimedMeeting {
  id: string;
  board_id: string;
  youtube_id: string;
  title: string | null;
  duration_seconds: number | null;
}

/**
 * Atomically claim the oldest `pending` meeting via the Postgres RPC,
 * which runs `SELECT ... FOR UPDATE SKIP LOCKED` + `UPDATE status='extracting'`
 * inside a single function. Returns null when no rows are claimable.
 */
export async function claimPendingMeeting(
  supabase: SupabaseClient<Database>,
): Promise<ClaimedMeeting | null> {
  const { data, error } = await supabase.rpc('claim_pending_meeting');
  if (error) {
    throw new Error(`claim_pending_meeting RPC failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return null;
  }
  const row = data[0];
  if (!row) {
    throw new Error('claim_pending_meeting RPC returned an empty row in non-empty data array');
  }
  return {
    id: row.id,
    board_id: row.board_id,
    youtube_id: row.youtube_id,
    title: row.title,
    duration_seconds: row.duration_seconds,
  };
}
