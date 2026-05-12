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

  const { data: towns } = await supabase
    .from('towns')
    .select('id, slug, name')
    .eq('publication_id', publication.id)
    .order('name');

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold">{publication.name}</h1>
      <p className="mt-2">
        <Link href={`/${publication.slug}/search`} className="text-blue-700 hover:underline">
          Search this publication →
        </Link>
      </p>
      <ul className="mt-6 space-y-2">
        {(towns ?? []).map((t) => (
          <li key={t.id}>
            <Link
              href={`/${publication.slug}/${t.slug}`}
              className="text-blue-700 underline-offset-2 hover:underline"
            >
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
