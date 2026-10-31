'use client';
// client: defers mounting the segment's YouTube iframe until the reader asks for it.

import { useState } from 'react';
import { YouTubeEmbed } from '@/components/youtube-embed.js';
import { formatTimestamp } from '@/lib/format-duration.js';

// A meeting page carries one segment per agenda item (~30–40). Mounting every
// iframe up front loaded that many YouTube players on page open. The embed
// pattern itself is unchanged (per-segment iframe, `?start=`, B3 fallback;
// apps/web/CLAUDE.md §5) — it is only mounted on demand.
export function SegmentVideo({
  youtubeId,
  startSeconds,
  transcriptExcerpt,
}: {
  youtubeId: string;
  startSeconds: number;
  transcriptExcerpt: string;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    // basis-full: the card lays the play button and transcript toggle out in a
    // wrapping row; the player takes a row of its own.
    return (
      <div className="w-full basis-full">
        <YouTubeEmbed
          youtubeId={youtubeId}
          startSeconds={startSeconds}
          transcriptExcerpt={transcriptExcerpt}
          autoplay
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:border-blue-800 hover:text-blue-800"
    >
      <span aria-hidden="true">▶</span> Play from {formatTimestamp(startSeconds)}
    </button>
  );
}
