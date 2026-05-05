import { getSupabaseServerClient } from '../lib/supabase-server.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('_scaffold_health')
    .select('message')
    .limit(1)
    .maybeSingle();

  const message = error ? `db unreachable: ${error.message}` : (data?.message ?? 'no rows');

  return (
    <main>
      <h1>Duly Noted</h1>
      <p>{message}</p>
    </main>
  );
}
