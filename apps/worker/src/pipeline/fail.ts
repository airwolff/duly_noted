import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';

const LAST_ERROR_MAX_LEN = 4000;

/**
 * Mark a meeting as failed with the truncated error message and a
 * `failed_at` timestamp. Per CLAUDE.md §7 there is no automatic retry —
 * an operator manually resets the row to revisit.
 */
export async function markFailed(
  supabase: SupabaseClient<Database>,
  meetingId: string,
  errorMessage: string,
): Promise<void> {
  const truncated =
    errorMessage.length > LAST_ERROR_MAX_LEN
      ? errorMessage.slice(0, LAST_ERROR_MAX_LEN)
      : errorMessage;
  const { error } = await supabase
    .from('meetings')
    .update({
      status: 'failed',
      last_error: truncated,
      failed_at: new Date().toISOString(),
    })
    .eq('id', meetingId);
  if (error) {
    throw new Error(`markFailed update failed for ${meetingId}: ${error.message}`);
  }
}
