import Link from 'next/link';

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

const MARKER_LABEL: Record<SearchResult['marker_type'], string> = {
  AGENDA_ITEM: 'Agenda item',
  PUBLIC_COMMENT: 'Public comment',
  DISCUSSION: 'Discussion',
  VOTE: 'Vote',
  PROCEDURE: 'Procedure',
};

const SNIPPET_MAX_LEN = 280;

function snippet(text: string): string {
  return text.length > SNIPPET_MAX_LEN ? `${text.slice(0, SNIPPET_MAX_LEN).trimEnd()}…` : text;
}

export function SearchResultCard({ result }: { result: SearchResult }) {
  const href =
    `/${result.publication_slug}/${result.town_slug}/${result.board_slug}/${result.meeting_id}` +
    `#segment-${result.segment_id}`;
  return (
    <article className="rounded border border-slate-200 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        {result.town_name} / {result.board_name}
        {result.meeting_date ? ` · ${result.meeting_date}` : ''}
      </p>
      <Link href={href} className="mt-1 block">
        <span className="font-semibold text-blue-700 hover:underline">
          {result.meeting_title ?? '(untitled)'} — {result.segment_title}
        </span>
      </Link>
      <p className="mt-1 text-xs">
        <span className="rounded bg-slate-100 px-2 py-0.5 uppercase tracking-wide text-slate-700">
          {MARKER_LABEL[result.marker_type]}
        </span>
      </p>
      <p className="mt-2 text-sm text-slate-700">{snippet(result.transcript_excerpt)}</p>
    </article>
  );
}
