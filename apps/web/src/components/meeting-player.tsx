'use client';
// client: one shared player whose position the agenda's play buttons set.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { YouTubeEmbed } from '@/components/youtube-embed.js';
import { formatTimestamp } from '@/lib/format-duration.js';

export interface PlayableSegment {
  id: string;
  title: string;
  startSeconds: number;
  excerpt: string;
}

interface Cue {
  segment: PlayableSegment | null;
  autoplay: boolean;
  /** Bumped on every cue so replaying the same item remounts the iframe. */
  n: number;
}

interface PlayerContextValue {
  activeId: string | null;
  play: (segmentId: string) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

// Jumping remounts the iframe with a new `?start=` rather than seeking through
// the IFrame Player API, so the embed pattern in apps/web/CLAUDE.md §5 holds:
// the API is still only used for the B3 onError fallback.
export function MeetingPlayer({
  youtubeId,
  segments,
  children,
}: {
  youtubeId: string;
  segments: PlayableSegment[];
  children: ReactNode;
}) {
  const [cue, setCue] = useState<Cue>({ segment: null, autoplay: false, n: 0 });
  const byId = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);

  const play = useCallback(
    (segmentId: string) => {
      const segment = byId.get(segmentId);
      if (segment) setCue((c) => ({ segment, autoplay: true, n: c.n + 1 }));
    },
    [byId],
  );

  // Search results link to #segment-<id>. Cue the player there without
  // autoplay; browsers block autoplay that no click started.
  useEffect(() => {
    const segment = byId.get(window.location.hash.replace(/^#segment-/, ''));
    if (segment) setCue((c) => ({ segment, autoplay: false, n: c.n + 1 }));
  }, [byId]);

  const start = cue.segment?.startSeconds ?? 0;

  return (
    <PlayerContext.Provider value={{ activeId: cue.segment?.id ?? null, play }}>
      {/* Negative margins bleed the band to the column edges so content
          scrolling underneath never shows beside the video. */}
      <div className="sticky top-0 z-20 -mx-4 mt-4 border-b border-stone-200 bg-stone-50 px-4 py-3 sm:-mx-8 sm:px-8">
        <YouTubeEmbed
          key={cue.n}
          youtubeId={youtubeId}
          startSeconds={start}
          transcriptExcerpt={cue.segment?.excerpt ?? ''}
          autoplay={cue.autoplay}
          className="aspect-video w-full"
        />
        {/* One line, truncated, so the band's height stays predictable for the
            agenda cards' scroll-mt. */}
        <p className="mt-2 truncate text-sm text-stone-600">
          <span className="font-semibold uppercase tracking-wide text-stone-500">
            {cue.segment ? `Now playing · ${formatTimestamp(start)}` : 'Full meeting'}
          </span>
          <span className="mx-2 text-stone-300">|</span>
          <span className="font-serif font-semibold text-stone-900">
            {cue.segment ? cue.segment.title : 'Pick an agenda item below to jump to it.'}
          </span>
        </p>
      </div>
      {children}
    </PlayerContext.Provider>
  );
}

export function PlayButton({
  segmentId,
  startSeconds,
}: {
  segmentId: string;
  startSeconds: number;
}) {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('PlayButton must be rendered inside MeetingPlayer');
  const active = player.activeId === segmentId;
  return (
    <button
      type="button"
      onClick={() => player.play(segmentId)}
      aria-pressed={active}
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-md border border-blue-800 bg-blue-800 px-3 py-1.5 text-sm font-medium text-white'
          : 'inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:border-blue-800 hover:text-blue-800'
      }
    >
      <span aria-hidden="true">▶</span>
      {active
        ? `Playing from ${formatTimestamp(startSeconds)}`
        : `Play from ${formatTimestamp(startSeconds)}`}
    </button>
  );
}
