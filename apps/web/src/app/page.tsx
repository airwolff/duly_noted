import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await getSupabaseServerClient();

  // RLS filters memberships to the current user; one row → one
  // publication slug → redirect there. Zero rows → empty-state.
  const { data } = await supabase
    .from('memberships')
    .select('publication:publications!inner(slug)')
    .limit(1)
    .maybeSingle();

  const slug = (data as { publication?: { slug: string } } | null)?.publication?.slug;
  if (slug) redirect(`/${slug}`);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="mt-4 text-slate-700">
        Your account isn&apos;t connected to a publication yet. Ask an administrator for access.
      </p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button type="submit" className="text-sm text-slate-600 underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
