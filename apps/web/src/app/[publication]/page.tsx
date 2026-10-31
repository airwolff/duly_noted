import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolvePublication } from '@/lib/resolvers.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function PublicationPage({
  params,
}: {
  params: Promise<{ publication: string }>;
}) {
  const { publication: pubSlug } = await params;
  const supabase = await getSupabaseServerClient();
  const publication = await resolvePublication(supabase, pubSlug);
  if (!publication) notFound();

  // Towns with their boards in one round trip, so the landing page goes
  // straight to something readable instead of a one-item town list.
  const { data: rawTowns } = await supabase
    .from('towns')
    .select('id, slug, name, boards(id, slug, name)')
    .eq('publication_id', publication.id)
    .order('name');

  const towns = rawTowns as Array<{
    id: string;
    slug: string;
    name: string;
    boards: Array<{ id: string; slug: string; name: string }>;
  }> | null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="font-serif text-4xl font-bold tracking-tight">{publication.name}</h1>
      <p className="mt-3 max-w-prose text-lg leading-relaxed text-stone-600">
        Local government meetings, summarized. Each meeting is broken into its agenda items, and
        every item links to the moment in the video where it was discussed.
      </p>
      <div className="mt-10 space-y-8">
        {(towns ?? []).map((t) => (
          <section key={t.id}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              <Link href={`/${publication.slug}/${t.slug}`} className="hover:underline">
                {t.name}
              </Link>
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {[...t.boards]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/${publication.slug}/${t.slug}/${b.slug}`}
                      className="block rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow"
                    >
                      <span className="font-serif text-xl font-semibold">{b.name}</span>
                      <span className="mt-1 block text-sm text-blue-800">Browse meetings →</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
