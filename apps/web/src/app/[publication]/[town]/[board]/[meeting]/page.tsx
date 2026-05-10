import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolveBoardChain } from '@/lib/resolvers.js';
import { sortSegments } from '@/lib/sort-segments.js';
import { SegmentCard } from '@/components/segment-card.js';
import type { Database } from '@duly-noted/db';

type MeetingRow = Database['public']['Tables']['meetings']['Row'];
type SegmentRow = Database['public']['Tables']['segments']['Row'];
type MeetingWithSegments = MeetingRow & { segments: SegmentRow[] };

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ publication: string; town: string; board: string; meeting: string }>;
}) {
  const { publication: p, town: t, board: b, meeting: meetingId } = await params;
  const supabase = await getSupabaseServerClient();
  const chain = await resolveBoardChain(supabase, p, t, b);
  if (!chain) notFound();

  const { data } = await supabase
    .from('meetings')
    .select('*, segments(*)')
    .eq('id', meetingId)
    .eq('board_id', chain.board.id)
    .eq('status', 'published')
    .maybeSingle();

  const meeting = data as unknown as MeetingWithSegments | null;
  if (!meeting) notFound();

  const segments = sortSegments(meeting.segments ?? []);
  const youtubeWatch = `https://www.youtube.com/watch?v=${meeting.youtube_id}`;

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
        {' / '}
        <Link
          href={`/${chain.publication.slug}/${chain.town.slug}/${chain.board.slug}`}
          className="hover:underline"
        >
          {chain.board.name}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold">{meeting.title ?? '(untitled)'}</h1>
      <p className="text-slate-600">
        {meeting.meeting_date}
        {' · '}
        <a href={youtubeWatch} className="text-blue-700 hover:underline" rel="noreferrer">
          Watch on YouTube
        </a>
      </p>
      {meeting.summary && (
        <section className="mt-6 rounded bg-slate-50 p-4">
          <h2 className="text-lg font-semibold">Summary</h2>
          <p className="mt-2 whitespace-pre-wrap">{meeting.summary}</p>
        </section>
      )}
      <section className="mt-8 space-y-4">
        {segments.length === 0 ? (
          <p className="text-slate-500">No segments are available for this meeting.</p>
        ) : (
          segments.map((s) => <SegmentCard key={s.id} segment={s} youtubeId={meeting.youtube_id} />)
        )}
      </section>
    </main>
  );
}
