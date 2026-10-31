import Link from 'next/link';
import { MarkerBadge } from '@/components/marker-badge.js';
import { excerptSnippetText } from '@/lib/clean-excerpt.js';
import { formatMeetingDate } from '@/lib/format-meeting-date.js';
import { formatTimestamp } from '@/lib/format-duration.js';

export interface SearchResult {
  segment_id: string;
  meeting_id: string;
  publication_slug: string;
  town_slug: string;
  town_name: string;
  board_slug: string;
  board_name: string;
  meeting_title: string | null;
  meeting_date: string | null;
  segment_title: string;
  segment_description: string;
  marker_type: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
  transcript_excerpt: string;
  start_time_seconds: number;
  rrf_score: number;
}

const SNIPPET_MAX_LEN = 220;

function snippet(text: string): string {
  return text.length > SNIPPET_MAX_LEN ? `${text.slice(0, SNIPPET_MAX_LEN).trimEnd()}…` : text;
}

export function SearchResultCard({ result }: { result: SearchResult }) {
  const href =
    `/${result.publication_slug}/${result.town_slug}/${result.board_slug}/${result.meeting_id}` +
    `#segment-${result.segment_id}`;
  const quote = snippet(excerptSnippetText(result.transcript_excerpt));
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-stone-500">
        {result.town_name} {result.board_name}
        {' · '}
        {formatMeetingDate(result.meeting_date) ?? result.meeting_title ?? 'Undated meeting'}
        {' · '}
        {formatTimestamp(result.start_time_seconds)}
      </p>
      <Link href={href} className="mt-2 block">
        <h2 className="font-serif text-xl font-semibold leading-snug text-stone-900 hover:text-blue-800 hover:underline">
          {result.segment_title}
        </h2>
      </Link>
      <div className="mt-2">
        <MarkerBadge markerType={result.marker_type} />
      </div>
      <p className="mt-3 leading-relaxed text-stone-700">{result.segment_description}</p>
      {quote && (
        <blockquote className="mt-3 border-l-2 border-stone-300 pl-4 text-sm italic leading-relaxed text-stone-500">
          “{quote}”
        </blockquote>
      )}
    </article>
  );
}
