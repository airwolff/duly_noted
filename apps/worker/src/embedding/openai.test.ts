import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '@duly-noted/shared';
import { createOpenAIEmbedder } from './openai.js';

function dummyVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);
}

function okJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

describe('createOpenAIEmbedder', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the embeddings array on success', async () => {
    const v1 = dummyVector();
    const v2 = dummyVector().map((x) => x + 0.1);
    const fetchSpy = vi.fn(async () =>
      okJsonResponse({
        data: [
          { index: 0, embedding: v1 },
          { index: 1, embedding: v2 },
        ],
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [] });
    const result = await embed(['a', 'b']);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(EMBEDDING_DIMENSIONS);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      input: string[];
    };
    expect(body.model).toBe(EMBEDDING_MODEL);
    expect(body.input).toEqual(['a', 'b']);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
  });

  it('retries on 429 then succeeds', async () => {
    const v = dummyVector();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(okJsonResponse({ data: [{ embedding: v }] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [0] });
    const result = await embed(['x']);

    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 then fails after exhausting attempts', async () => {
    const fetchSpy = vi.fn(async () => new Response('upstream', { status: 503 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [0, 0, 0] });
    await expect(embed(['x'])).rejects.toThrow(/openai/);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it('does NOT retry on 4xx other than 429', async () => {
    const fetchSpy = vi.fn(async () => new Response('bad key', { status: 401 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [0, 0, 0] });
    await expect(embed(['x'])).rejects.toThrow(/401/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a response with a mismatched embedding length', async () => {
    const fetchSpy = vi.fn(async () => okJsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const embed = createOpenAIEmbedder('test-key', { retryDelaysMs: [] });
    await expect(embed(['x'])).rejects.toThrow();
  });
});
