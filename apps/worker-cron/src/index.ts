import { createServiceClient } from '@duly-noted/db';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createServiceClient({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const { error, count } = await supabase
    .from('_scaffold_health')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`cron tick ${new Date().toISOString()} db unreachable: ${error.message}`);
    process.exit(1);
  }

  console.log(`cron tick ${new Date().toISOString()} scaffold_health rows=${count ?? 0}`);
}

await main();
