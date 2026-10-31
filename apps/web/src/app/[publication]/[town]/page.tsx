import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolvePublication, resolveTown } from '@/lib/resolvers.js';
import { Breadcrumbs } from '@/components/breadcrumbs.js';

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
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <Breadcrumbs crumbs={[{ href: `/${publication.slug}`, label: publication.name }]} />
      <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight">{town.name}</h1>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {(boards ?? []).map((b) => (
          <li key={b.id}>
            <Link
              href={`/${publication.slug}/${town.slug}/${b.slug}`}
              className="block rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow"
            >
              <span className="font-serif text-xl font-semibold">{b.name}</span>
              <span className="mt-1 block text-sm text-blue-800">Browse meetings →</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
