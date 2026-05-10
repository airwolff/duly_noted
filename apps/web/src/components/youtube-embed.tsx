'use client';
// client: IFrame Player API onError handler drives the B3 fallback panel.

import { useEffect, useRef, useState } from 'react';
import { isFallbackErrorCode } from '@/lib/youtube-error.js';

interface YouTubeEmbedProps {
  youtubeId: string;
  startSeconds: number;
  transcriptExcerpt: string;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => unknown };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SCRIPT_ID = 'youtube-iframe-api';
let scriptLoading: Promise<void> | null = null;

function loadIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.getElementById(SCRIPT_ID)) {
      const tag = document.createElement('script');
      tag.id = SCRIPT_ID;
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
  return scriptLoading;
}

export function YouTubeEmbed({ youtubeId, startSeconds, transcriptExcerpt }: YouTubeEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!iframeRef.current) return;
    let cancelled = false;
    void loadIframeApi().then(() => {
      if (cancelled || !iframeRef.current || !window.YT?.Player) return;
      new window.YT.Player(iframeRef.current, {
        events: {
          onError: (event: { data: number }) => {
            if (isFallbackErrorCode(event.data)) setErrored(true);
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [youtubeId]);

  if (errored) {
    return (
      <div
        role="alert"
        data-testid="youtube-fallback"
        className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm"
      >
        <p className="font-medium">Video unavailable</p>
        <pre className="mt-2 whitespace-pre-wrap text-slate-800">{transcriptExcerpt}</pre>
        <a
          href={`https://www.youtube.com/watch?v=${youtubeId}&t=${startSeconds}s`}
          className="mt-2 inline-block text-blue-700 hover:underline"
          rel="noreferrer"
        >
          Open on YouTube
        </a>
      </div>
    );
  }

  return (
    <div className="mt-3 aspect-video">
      <iframe
        ref={iframeRef}
        data-testid="youtube-iframe"
        title="YouTube segment"
        src={`https://www.youtube.com/embed/${youtubeId}?start=${startSeconds}&enablejsapi=1`}
        allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
      />
    </div>
  );
}
