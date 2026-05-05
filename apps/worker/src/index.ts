import { createServiceClient } from '@duly-noted/db';
import { loadEnv } from './env.js';
import { startHeartbeat } from './heartbeat.js';

async function main(): Promise<void> {
  console.log('worker starting');

  const env = loadEnv();
  const supabase = createServiceClient({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const { error } = await supabase.from('_scaffold_health').select('id').limit(1);
  if (error) {
    console.error(`worker boot failed: db unreachable: ${error.message}`);
    process.exit(1);
  }
  console.log('db reachable');

  const heartbeat = startHeartbeat();

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`worker received ${signal}, shutting down`);
    heartbeat.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

await main();
