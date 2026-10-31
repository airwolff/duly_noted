import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { splitParagraphs } from '@/lib/split-paragraphs.js';
import { resolveBoardChain } from '@/lib/resolvers.js';
import { sortSegments } from '@/lib/sort-segments.js';
import { formatMeetingDate } from '@/lib/format-meeting-date.js';
import { formatDuration } from '@/lib/format-duration.js';
import { Breadcrumbs } from '@/components/breadcrumbs.js';
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
  const date = formatMeetingDate(meeting.meeting_date);
  const meta = [formatDuration(meeting.duration_seconds), `${segments.length} agenda items`].filter(
    Boolean,
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <Breadcrumbs
        crumbs={[
          { href: `/${chain.publication.slug}`, label: chain.publication.name },
          { href: `/${chain.publication.slug}/${chain.town.slug}`, label: chain.town.name },
          {
            href: `/${chain.publication.slug}/${chain.town.slug}/${chain.board.slug}`,
            label: chain.board.name,
          },
        ]}
      />
      <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {chain.town.name} {chain.board.name}
      </p>
      <h1 className="mt-1 font-serif text-4xl font-bold tracking-tight">
        {date ?? meeting.title ?? 'Untitled meeting'}
      </h1>
      <p className="mt-2 text-stone-600">
        {meta.join(' · ')}
        {' · '}
        <a href={youtubeWatch} className="text-blue-800 hover:underline" rel="noreferrer">
          Watch the full meeting on YouTube
        </a>
      </p>
      {meeting.summary && (
        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Summary</h2>
          {/* max-w-prose caps the measure at ~65 characters; longer lines are
              the main thing that makes a multi-paragraph summary hard to read
              on a wide screen. leading-relaxed opens up the line height. */}
          <div className="mt-4 max-w-prose space-y-4 font-serif text-lg leading-relaxed text-stone-800">
            {splitParagraphs(meeting.summary).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </section>
      )}
      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold">Agenda</h2>
        <p className="mt-1 text-sm text-stone-500">
          In the order discussed. Play any item to jump to that point in the video.
        </p>
        <div className="mt-6 space-y-4">
          {segments.length === 0 ? (
            <p className="text-stone-500">No agenda items are available for this meeting.</p>
          ) : (
            segments.map((s) => (
              <SegmentCard key={s.id} segment={s} youtubeId={meeting.youtube_id} />
            ))
          )}
        </div>
      </section>
    </main>
  );
}
