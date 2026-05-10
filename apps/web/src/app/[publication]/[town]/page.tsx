import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolvePublication, resolveTown } from '@/lib/resolvers.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function TownPage({
  params,
}: {
  params: Promise<{ publication: string; town: string }>;
}) {
  const { publication: pubSlug, town: townSlug } = await params;
  const supabase = await getSupabaseServerClient();
  const publication = await resolvePublication(supabase, pubSlug);
  if (!publication) notFound();
  const town = await resolveTown(supabase, publication, townSlug);
  if (!town) notFound();

  const { data: boards } = await supabase
    .from('boards')
    .select('id, slug, name')
    .eq('town_id', town.id)
    .order('name');

  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm text-slate-500">
        <Link href={`/${publication.slug}`} className="hover:underline">
          {publication.name}
        </Link>
      </p>
      <h1 className="text-3xl font-bold">{town.name}</h1>
      <ul className="mt-6 space-y-2">
        {(boards ?? []).map((b) => (
          <li key={b.id}>
            <Link
              href={`/${publication.slug}/${town.slug}/${b.slug}`}
              className="text-blue-700 underline-offset-2 hover:underline"
            >
              {b.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
