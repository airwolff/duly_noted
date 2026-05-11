import { YouTubeEmbed } from '@/components/youtube-embed.js';
import { TranscriptToggle } from '@/components/transcript-toggle.js';
import type { Database } from '@duly-noted/db';

type Segment = Database['public']['Tables']['segments']['Row'];

const MARKER_LABEL: Record<Segment['marker_type'], string> = {
  AGENDA_ITEM: 'Agenda item',
  PUBLIC_COMMENT: 'Public comment',
  DISCUSSION: 'Discussion',
  VOTE: 'Vote',
  PROCEDURE: 'Procedure',
};

export function SegmentCard({ segment, youtubeId }: { segment: Segment; youtubeId: string }) {
  return (
    <article id={`segment-${segment.id}`} className="rounded border border-slate-200 p-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-700">
          {MARKER_LABEL[segment.marker_type]}
        </span>
        <h2 className="font-semibold">{segment.title}</h2>
      </div>
      <p className="mt-2 text-slate-700">{segment.description}</p>
      <YouTubeEmbed
        youtubeId={youtubeId}
        startSeconds={segment.start_time_seconds}
        transcriptExcerpt={segment.transcript_excerpt}
      />
      <TranscriptToggle excerpt={segment.transcript_excerpt} />
    </article>
  );
}
