import { PlayButton } from '@/components/meeting-player.js';
import { TranscriptToggle } from '@/components/transcript-toggle.js';
import { MarkerBadge } from '@/components/marker-badge.js';
import { stripUtteranceMarkers } from '@/lib/clean-excerpt.js';
import type { Database } from '@duly-noted/db';

type Segment = Database['public']['Tables']['segments']['Row'];

export function SegmentCard({ segment }: { segment: Segment }) {
  const excerpt = stripUtteranceMarkers(segment.transcript_excerpt);
  return (
    // scroll-mt clears the sticky player band (MeetingPlayer) when a search
    // result deep-links here: a full-column 16:9 video plus its caption line.
    <article
      id={`segment-${segment.id}`}
      className="scroll-mt-[calc(min(100vw,48rem)*0.5625+5rem)] rounded-lg border border-stone-200 bg-white p-5 shadow-sm target:ring-2 target:ring-blue-700"
    >
      <div className="flex flex-wrap items-center gap-2">
        <MarkerBadge markerType={segment.marker_type} />
      </div>
      <h3 className="mt-2 font-serif text-xl font-semibold leading-snug">{segment.title}</h3>
      <p className="mt-2 leading-relaxed text-stone-700">{segment.description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <PlayButton segmentId={segment.id} startSeconds={segment.start_time_seconds} />
        <TranscriptToggle excerpt={excerpt} />
      </div>
    </article>
  );
}
