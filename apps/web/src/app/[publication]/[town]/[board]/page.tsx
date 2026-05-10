import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolveBoardChain } from '@/lib/resolvers.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ publication: string; town: string; board: string }>;
}) {
  const { publication: pSlug, town: tSlug, board: bSlug } = await params;
  const supabase = await getSupabaseServerClient();
  const chain = await resolveBoardChain(supabase, pSlug, tSlug, bSlug);
  if (!chain) notFound();

  const { data: meetings } = await supabase
    .from('meetings')
    .select('id, title, meeting_date')
    .eq('board_id', chain.board.id)
    .eq('status', 'published')
    .order('meeting_date', { ascending: false });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm text-slate-500">
        <Link href={`/${chain.publication.slug}`} className="hover:underline">
          {chain.publication.name}
        </Link>
        {' / '}
        <Link href={`/${chain.publication.slug}/${chain.town.slug}`} className="hover:underline">
          {chain.town.name}
        </Link>
      </p>
      <h1 className="text-3xl font-bold">{chain.board.name}</h1>
      <ul className="mt-6 divide-y">
        {(meetings ?? []).map((m) => (
          <li key={m.id} className="py-3">
            <Link
              href={`/${chain.publication.slug}/${chain.town.slug}/${chain.board.slug}/${m.id}`}
              className="block text-blue-700 hover:underline"
            >
              <span className="block text-sm text-slate-500">
                {m.meeting_date ?? 'Date unknown'}
              </span>
              <span className="block">{m.title ?? '(untitled)'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
