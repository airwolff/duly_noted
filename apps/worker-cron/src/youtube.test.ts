import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUploadsPlaylistItems, fetchVideoDetails, parseIsoDuration } from './youtube.js';

describe('parseIsoDuration', () => {
  it('parses hours, minutes, seconds', () => {
    expect(parseIsoDuration('PT1H30M15S')).toBe(1 * 3600 + 30 * 60 + 15);
  });
  it('parses PT1H30M45S', () => {
    expect(parseIsoDuration('PT1H30M45S')).toBe(1 * 3600 + 30 * 60 + 45);
  });
  it('parses minutes only', () => {
    expect(parseIsoDuration('PT45M')).toBe(45 * 60);
  });
  it('parses PT5M', () => {
    expect(parseIsoDuration('PT5M')).toBe(5 * 60);
  });
  it('parses seconds only', () => {
    expect(parseIsoDuration('PT12S')).toBe(12);
  });
  it('parses PT45S', () => {
    expect(parseIsoDuration('PT45S')).toBe(45);
  });
  it('parses zero', () => {
    expect(parseIsoDuration('PT0S')).toBe(0);
  });
  it('parses P0D as zero (YouTube live/premiere/processing)', () => {
    expect(parseIsoDuration('P0D')).toBe(0);
  });
  it('parses P1D as 86400 seconds', () => {
    expect(parseIsoDuration('P1D')).toBe(86400);
  });
  it('parses days plus time components', () => {
    expect(parseIsoDuration('P1DT2H30M')).toBe(86400 + 2 * 3600 + 30 * 60);
  });
  it('throws on garbage', () => {
    expect(() => parseIsoDuration('1h30m')).toThrow();
  });
});

describe('fetchUploadsPlaylistItems', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('hits playlistItems.list with the expected query string and parses the response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                resourceId: { videoId: 'abc' },
                title: 'Select Board 2026-04-15',
                publishedAt: '2026-04-15T20:00:00Z',
              },
            },
            {
              snippet: {
                resourceId: { videoId: 'def' },
                title: 'Town Meeting',
                publishedAt: '2026-04-10T18:00:00Z',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const items = await fetchUploadsPlaylistItems({
      apiKey: 'KEY',
      uploadsPlaylistId: 'UU1QHI-zQvIIkptXJsupfTZg',
      cutoffAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(items).toEqual([
      { videoId: 'abc', title: 'Select Board 2026-04-15', publishedAt: '2026-04-15T20:00:00Z' },
      { videoId: 'def', title: 'Town Meeting', publishedAt: '2026-04-10T18:00:00Z' },
    ]);
    const [url] = fetchSpy.mock.calls[0]!;
    const requestUrl = url instanceof URL ? url : new URL(String(url));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      'https://www.googleapis.com/youtube/v3/playlistItems',
    );
    expect(requestUrl.searchParams.get('part')).toBe('snippet');
    expect(requestUrl.searchParams.get('maxResults')).toBe('10');
    expect(requestUrl.searchParams.get('playlistId')).toBe('UU1QHI-zQvIIkptXJsupfTZg');
    expect(requestUrl.searchParams.get('key')).toBe('KEY');
    expect(requestUrl.searchParams.get('pageToken')).toBeNull();
  });

  it('skips items published before the cutoff and short-circuits pagination on the first stale item', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                resourceId: { videoId: 'fresh' },
                title: 'Fresh Meeting',
                publishedAt: '2026-04-15T20:00:00Z',
              },
            },
            {
              snippet: {
                resourceId: { videoId: 'stale' },
                title: 'Pre-launch Meeting',
                publishedAt: '2024-01-01T00:00:00Z',
              },
            },
            {
              snippet: {
                resourceId: { videoId: 'also-stale' },
                title: 'Even Older',
                publishedAt: '2023-06-15T00:00:00Z',
              },
            },
          ],
          nextPageToken: 'NEXT',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const items = await fetchUploadsPlaylistItems({
      apiKey: 'KEY',
      uploadsPlaylistId: 'UU1QHI-zQvIIkptXJsupfTZg',
      cutoffAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(items.map((i) => i.videoId)).toEqual(['fresh']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('paginates with pageToken when the whole page is within the cutoff and nextPageToken is present', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                snippet: {
                  resourceId: { videoId: 'a' },
                  title: 'A',
                  publishedAt: '2026-05-01T00:00:00Z',
                },
              },
              {
                snippet: {
                  resourceId: { videoId: 'b' },
                  title: 'B',
                  publishedAt: '2026-04-25T00:00:00Z',
                },
              },
            ],
            nextPageToken: 'TOKEN2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                snippet: {
                  resourceId: { videoId: 'c' },
                  title: 'C',
                  publishedAt: '2026-04-20T00:00:00Z',
                },
              },
              {
                snippet: {
                  resourceId: { videoId: 'stale' },
                  title: 'Stale',
                  publishedAt: '2024-12-01T00:00:00Z',
                },
              },
            ],
            nextPageToken: 'TOKEN3',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const items = await fetchUploadsPlaylistItems({
      apiKey: 'KEY',
      uploadsPlaylistId: 'UU1QHI-zQvIIkptXJsupfTZg',
      cutoffAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(items.map((i) => i.videoId)).toEqual(['a', 'b', 'c']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchSpy.mock.calls[1]!;
    const secondRequestUrl = secondUrl instanceof URL ? secondUrl : new URL(String(secondUrl));
    expect(secondRequestUrl.searchParams.get('pageToken')).toBe('TOKEN2');
  });

  it('stops paginating when the last page has no nextPageToken even if all items are within cutoff', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                resourceId: { videoId: 'only' },
                title: 'Only',
                publishedAt: '2026-05-01T00:00:00Z',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const items = await fetchUploadsPlaylistItems({
      apiKey: 'KEY',
      uploadsPlaylistId: 'UU1QHI-zQvIIkptXJsupfTZg',
      cutoffAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(items.map((i) => i.videoId)).toEqual(['only']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('fetchVideoDetails', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns empty list and skips the network call when given no ids', async () => {
    const result = await fetchVideoDetails({ apiKey: 'K', videoIds: [] });
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hits videos.list with comma-joined ids and parses durations', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'abc',
              snippet: { title: 'Select Board 2026-04-15', channelId: 'UC1QHI-zQvIIkptXJsupfTZg' },
              contentDetails: { duration: 'PT1H15M' },
            },
            {
              id: 'def',
              snippet: { title: 'Town Meeting', channelId: 'UC1QHI-zQvIIkptXJsupfTZg' },
              contentDetails: { duration: 'PT45M' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const details = await fetchVideoDetails({ apiKey: 'KEY', videoIds: ['abc', 'def'] });
    expect(details).toHaveLength(2);
    expect(details[0]).toEqual({
      id: 'abc',
      title: 'Select Board 2026-04-15',
      channelId: 'UC1QHI-zQvIIkptXJsupfTZg',
      durationSeconds: 4500,
    });
    expect(details[1]?.durationSeconds).toBe(2700);

    const [url] = fetchSpy.mock.calls[0]!;
    const requestUrl = url instanceof URL ? url : new URL(String(url));
    expect(requestUrl.searchParams.get('id')).toBe('abc,def');
    expect(requestUrl.searchParams.get('part')).toBe('contentDetails,snippet');
  });

  it('throws when given more than 50 ids', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `vid${i}`);
    await expect(fetchVideoDetails({ apiKey: 'K', videoIds: ids })).rejects.toThrow(/50/);
  });

  it('skips items with unparseable durations and logs the offender, without failing the call', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'good',
              snippet: { title: 'Select Board 2026-04-15', channelId: 'UCabc' },
              contentDetails: { duration: 'PT1H15M' },
            },
            {
              id: 'live',
              snippet: { title: 'LIVE: Town Meeting', channelId: 'UCabc' },
              contentDetails: { duration: 'P0D' },
            },
            {
              id: 'broken',
              snippet: { title: 'Garbage', channelId: 'UCabc' },
              contentDetails: { duration: 'WHATEVER' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const details = await fetchVideoDetails({
      apiKey: 'K',
      videoIds: ['good', 'live', 'broken'],
    });

    expect(details).toHaveLength(2);
    expect(details.map((d) => d.id)).toEqual(['good', 'live']);
    expect(details[0]?.durationSeconds).toBe(4500);
    expect(details[1]?.durationSeconds).toBe(0);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/videoId=broken/);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/duration=WHATEVER/);

    warnSpy.mockRestore();
  });
});
