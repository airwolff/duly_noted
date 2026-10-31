import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolvePublication } from '@/lib/resolvers.js';
import { SearchInput } from '@/components/search-input.js';
import { SearchResultCard, type SearchResult } from '@/components/search-result-card.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const DEFAULT_MATCH_COUNT = 20;
const SHOW_MORE_MATCH_COUNT = 50;

interface InvokeResponse {
  results?: SearchResult[];
  error?: string;
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ publication: string }>;
  searchParams: Promise<{ q?: string; more?: string }>;
}) {
  const { publication: pSlug } = await params;
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const matchCount = sp.more === '1' ? SHOW_MORE_MATCH_COUNT : DEFAULT_MATCH_COUNT;

  const supabase = await getSupabaseServerClient();
  const publication = await resolvePublication(supabase, pSlug);
  if (!publication) notFound();

  let results: SearchResult[] = [];
  let errorMessage: string | null = null;
  if (query.length > 0) {
    const { data, error } = await supabase.functions.invoke<InvokeResponse>('search', {
      body: { query, match_count: matchCount },
    });
    if (error) {
      errorMessage = error.message || 'Search failed';
    } else {
      results = data?.results ?? [];
    }
  }

  const showMoreHref =
    query.length > 0 && results.length === DEFAULT_MATCH_COUNT && sp.more !== '1'
      ? `/${publication.slug}/search?q=${encodeURIComponent(query)}&more=1`
      : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="font-serif text-4xl font-bold tracking-tight">Search</h1>
      <p className="mt-2 text-stone-600">
        Finds agenda items by keyword and by meaning across every published meeting.
      </p>
      <div className="mt-6">
        <SearchInput defaultQuery={query} />
      </div>

      {errorMessage && (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Search failed: {errorMessage}.{' '}
          <Link
            href={`/${publication.slug}/search?q=${encodeURIComponent(query)}`}
            className="underline"
          >
            Retry
          </Link>
        </div>
      )}

      {query.length > 0 && !errorMessage && results.length === 0 && (
        <p className="mt-8 text-stone-500">No agenda items matched. Try different words.</p>
      )}

      {results.length > 0 && (
        <>
          <p className="mt-8 text-sm text-stone-500">
            {results.length} {results.length === 1 ? 'result' : 'results'} for “{query}”
          </p>
          <section className="mt-3 space-y-4">
            {results.map((r) => (
              <SearchResultCard key={r.segment_id} result={r} />
            ))}
          </section>
        </>
      )}

      {showMoreHref && (
        <p className="mt-6">
          <Link href={showMoreHref} className="font-medium text-blue-800 hover:underline">
            Show more results
          </Link>
        </p>
      )}
    </main>
  );
}
