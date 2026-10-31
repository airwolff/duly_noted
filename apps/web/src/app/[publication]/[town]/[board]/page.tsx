import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolveBoardChain } from '@/lib/resolvers.js';
import { formatMeetingDate } from '@/lib/format-meeting-date.js';
import { formatDuration } from '@/lib/format-duration.js';
import { splitParagraphs } from '@/lib/split-paragraphs.js';
import { Breadcrumbs } from '@/components/breadcrumbs.js';

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

  // Count segments client-side from their ids. PostgREST's `segments(count)`
  // needs table-level SELECT on segments, and anon only holds column-level
  // grants (embedding is withheld), so the aggregate fails with 42501 for
  // signed-out readers on a public_read publication (ADR 0024).
  const { data: rawMeetings } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, duration_seconds, summary, segments(id)')
    .eq('board_id', chain.board.id)
    .eq('status', 'published')
    .order('meeting_date', { ascending: false, nullsFirst: false });

  const meetings = rawMeetings as Array<{
    id: string;
    title: string | null;
    meeting_date: string | null;
    duration_seconds: number | null;
    summary: string | null;
    segments: Array<{ id: string }>;
  }> | null;

  const base = `/${chain.publication.slug}/${chain.town.slug}/${chain.board.slug}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <Breadcrumbs
        crumbs={[
          { href: `/${chain.publication.slug}`, label: chain.publication.name },
          { href: `/${chain.publication.slug}/${chain.town.slug}`, label: chain.town.name },
        ]}
      />
      <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight">{chain.board.name}</h1>
      <p className="mt-2 text-stone-600">
        {meetings?.length ?? 0} {meetings?.length === 1 ? 'meeting' : 'meetings'}, newest first
      </p>
      <ul className="mt-8 space-y-4">
        {(meetings ?? []).map((m) => {
          const date = formatMeetingDate(m.meeting_date);
          const teaser = m.summary ? splitParagraphs(m.summary)[0] : null;
          const meta = [
            formatDuration(m.duration_seconds),
            `${m.segments.length} agenda items`,
          ].filter(Boolean);
          return (
            <li key={m.id}>
              <Link
                href={`${base}/${m.id}`}
                className="group block rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow sm:p-6"
              >
                <h2 className="font-serif text-2xl font-semibold group-hover:text-blue-800">
                  {date ?? m.title ?? 'Untitled meeting'}
                </h2>
                <p className="mt-1 text-sm text-stone-500">{meta.join(' · ')}</p>
                {teaser && (
                  <p className="mt-3 line-clamp-3 leading-relaxed text-stone-700">{teaser}</p>
                )}
                <span className="mt-3 inline-block text-sm font-medium text-blue-800">
                  Read the meeting →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
