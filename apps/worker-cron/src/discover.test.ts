import { describe, expect, it } from 'vitest';
import { chunkIds, selectNewVideoIds, selectRefreshableIds } from './discover.js';

describe('selectNewVideoIds', () => {
  it('returns ids that are not already in the existing set', () => {
    expect(selectNewVideoIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });

  it('preserves the input order', () => {
    expect(selectNewVideoIds(['c', 'a', 'b'], [])).toEqual(['c', 'a', 'b']);
  });

  it('deduplicates the fetched list', () => {
    expect(selectNewVideoIds(['a', 'a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns an empty array when every fetched id is already known', () => {
    expect(selectNewVideoIds(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('returns an empty array when the fetched list is empty', () => {
    expect(selectNewVideoIds([], ['a'])).toEqual([]);
  });
});

describe('selectRefreshableIds', () => {
  const row = (
    youtube_id: string,
    status: string,
    duration_seconds: number | null,
  ): { youtube_id: string | null; status: string; duration_seconds: number | null } => ({
    youtube_id,
    status,
    duration_seconds,
  });

  it('selects discovered rows whose duration is zero — the live-stream signature', () => {
    // YouTube reports PT0S while a video is still streaming. The row is written
    // once at discovery and the real duration never lands without a refresh.
    expect(selectRefreshableIds([row('a', 'discovered', 0)], ['a'])).toEqual(['a']);
  });

  it('selects discovered rows whose duration is null', () => {
    expect(selectRefreshableIds([row('a', 'discovered', null)], ['a'])).toEqual(['a']);
  });

  it('leaves rows that already carry a real duration alone', () => {
    expect(selectRefreshableIds([row('a', 'discovered', 2506)], ['a'])).toEqual([]);
  });

  it('never touches rows that have moved past discovered', () => {
    // Refreshing a claimed, failed, or published row would fight the worker.
    const rows = [
      row('a', 'pending', 0),
      row('b', 'extracting', 0),
      row('c', 'failed', 0),
      row('d', 'published', 0),
    ];
    expect(selectRefreshableIds(rows, ['a', 'b', 'c', 'd'])).toEqual([]);
  });

  it('bounds the refresh set to ids in the current playlist window', () => {
    // Rows older than boards.ingest_since_days fall out of the playlist fetch;
    // they must not accumulate into an ever-growing refresh list.
    expect(selectRefreshableIds([row('old', 'discovered', 0)], ['new'])).toEqual([]);
  });
});

describe('chunkIds', () => {
  it('splits into batches at the YouTube videos.list 50-id cap', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const chunks = chunkIds(ids, 50);
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('returns no batches for an empty list', () => {
    expect(chunkIds([], 50)).toEqual([]);
  });

  it('returns a single batch when the list fits', () => {
    expect(chunkIds(['a', 'b'], 50)).toEqual([['a', 'b']]);
  });
});
