import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { YouTubeEmbed } from './youtube-embed.js';

interface PlayerEvents {
  onError?: (e: { data: number }) => void;
}
let lastEvents: PlayerEvents | null = null;

beforeEach(() => {
  lastEvents = null;
  // Stub the IFrame API so loadIframeApi() resolves without a network call.
  (window as unknown as { YT?: unknown }).YT = {
    Player: vi.fn().mockImplementation((_el: HTMLElement, opts: { events: PlayerEvents }) => {
      lastEvents = opts.events;
      return {};
    }),
  };
});

describe('YouTubeEmbed', () => {
  it('renders the iframe by default with start parameter', () => {
    render(<YouTubeEmbed youtubeId="abc" startSeconds={120} transcriptExcerpt="" />);
    const iframe = screen.getByTestId('youtube-iframe');
    expect(iframe).toHaveAttribute(
      'src',
      'https://www.youtube.com/embed/abc?start=120&enablejsapi=1',
    );
  });

  it('swaps to the fallback panel on error code 150', async () => {
    render(
      <YouTubeEmbed
        youtubeId="abc"
        startSeconds={42}
        transcriptExcerpt="Mr. Smith motioned to adjourn."
      />,
    );
    await waitFor(() => expect(lastEvents?.onError).toBeTypeOf('function'));
    lastEvents!.onError!({ data: 150 });
    await waitFor(() => expect(screen.getByTestId('youtube-fallback')).toBeInTheDocument());
    expect(screen.getByText('Video unavailable')).toBeInTheDocument();
    expect(screen.getByText('Mr. Smith motioned to adjourn.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open on youtube/i })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=abc&t=42s',
    );
  });

  it.each([100, 101, 153])('swaps to the fallback panel on error code %i', async (code) => {
    render(<YouTubeEmbed youtubeId="abc" startSeconds={0} transcriptExcerpt="" />);
    await waitFor(() => expect(lastEvents?.onError).toBeTypeOf('function'));
    lastEvents!.onError!({ data: code });
    await waitFor(() => expect(screen.getByTestId('youtube-fallback')).toBeInTheDocument());
  });

  it('does not swap on unrelated error code 5', async () => {
    render(<YouTubeEmbed youtubeId="abc" startSeconds={0} transcriptExcerpt="" />);
    await waitFor(() => expect(lastEvents?.onError).toBeTypeOf('function'));
    lastEvents!.onError!({ data: 5 });
    expect(screen.queryByTestId('youtube-fallback')).not.toBeInTheDocument();
  });
});
