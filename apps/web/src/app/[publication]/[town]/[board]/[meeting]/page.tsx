import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { splitParagraphs } from '@/lib/split-paragraphs.js';
import { resolveBoardChain } from '@/lib/resolvers.js';
import { sortSegments } from '@/lib/sort-segments.js';
import { SegmentCard } from '@/components/segment-card.js';
import type { Database } from '@duly-noted/db';

type MeetingRow = Database['public']['Tables']['meetings']['Row'];
type SegmentRow = Database['public']['Tables']['segments']['Row'];

// Columns the reader actually renders. Selecting them explicitly rather than
// `*` keeps two things out of the response: segments.embedding, a 1536-float
// vector per segment that no reader surface uses, and the meetings columns
// (audio_url, asr_transcript_id, transcript_url, last_error) that anon has no
// grant on under the public_read policies.
const MEETING_COLUMNS =
  'id, board_id, status, title, meeting_date, summary, duration_seconds, youtube_id';
const SEGMENT_COLUMNS =
  'id, meeting_id, sequence_order, marker_type, title, description, start_time_seconds, end_time_seconds, transcript_excerpt';

type MeetingWithSegments = Pick<
  MeetingRow,
  | 'id'
  | 'board_id'
  | 'status'
  | 'title'
  | 'meeting_date'
  | 'summary'
  | 'duration_seconds'
  | 'youtube_id'
> & {
  segments: SegmentRow[];
};

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
    .select(`${MEETING_COLUMNS}, segments(${SEGMENT_COLUMNS})`)
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
        <section className="mt-6 rounded border border-slate-200 bg-slate-50 p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Summary</h2>
          {/* max-w-prose caps the measure at ~65 characters; longer lines are
              the main thing that makes a multi-paragraph summary hard to read
              on a wide screen. leading-relaxed opens up the line height. */}
          <div className="mt-3 max-w-prose space-y-4 text-[1.0625rem] leading-relaxed text-slate-800">
            {splitParagraphs(meeting.summary).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
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
