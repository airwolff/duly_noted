import { createServiceClient } from '@duly-noted/db';
import { loadEnv } from './env.js';
import { discoverForBoard } from './discover.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createServiceClient({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const { data: boards, error } = await supabase
    .from('boards')
    .select('id, youtube_channel_id, uploads_playlist_id')
    .not('youtube_channel_id', 'is', null);
  if (error) {
    console.error(`cron tick ${new Date().toISOString()} boards query failed: ${error.message}`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  let totalInserted = 0;
  let totalPromoted = 0;
  let exitCode = 0;

  for (const board of boards ?? []) {
    try {
      const outcome = await discoverForBoard(
        { supabase, apiKey: env.YOUTUBE_API_KEY },
        {
          id: board.id,
          youtube_channel_id: board.youtube_channel_id,
          uploads_playlist_id: board.uploads_playlist_id,
        },
      );
      if (outcome.skippedReason) {
        console.log(`cron board=${board.id} skipped: ${outcome.skippedReason}`);
        continue;
      }
      totalInserted += outcome.inserted;
      totalPromoted += outcome.promoted;
      console.log(
        `cron board=${board.id} inserted=${outcome.inserted} promoted=${outcome.promoted}`,
      );
    } catch (err) {
      exitCode = 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`cron board=${board.id} failed: ${message}`);
    }
  }

  console.log(
    `cron tick ${startedAt} done boards=${boards?.length ?? 0} inserted=${totalInserted} promoted=${totalPromoted}`,
  );
  process.exit(exitCode);
}

await main();
