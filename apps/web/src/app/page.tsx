import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await getSupabaseServerClient();

  // RLS filters memberships to the current user; one row → one
  // publication slug → redirect there.
  const { data } = await supabase
    .from('memberships')
    .select('publication:publications!inner(slug)')
    .limit(1)
    .maybeSingle();

  const slug = (data as { publication?: { slug: string } } | null)?.publication?.slug;
  if (slug) redirect(`/${slug}`);

  // No membership. Before the no-access empty state, fall through to a
  // publication marked public_read — anon RLS returns only those, so a signed
  // -out visitor lands on readable content instead of a dead end. A signed-in
  // user without a membership takes this path too, which is correct: they get
  // the same public view anyone else does.
  const { data: publicPub } = await supabase
    .from('publications')
    .select('slug')
    .eq('public_read', true)
    .order('slug')
    .limit(1)
    .maybeSingle();

  if (publicPub?.slug) redirect(`/${publicPub.slug}`);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="mt-4 text-slate-700">
        Your account isn&apos;t connected to a publication yet. Ask an administrator for access.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        <Link href="/login" className="text-blue-700 underline-offset-2 hover:underline">
          Sign in with a different email
        </Link>
      </p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button type="submit" className="text-sm text-slate-600 underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
