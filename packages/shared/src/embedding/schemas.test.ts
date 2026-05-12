import { describe, expect, it } from 'vitest';
import { openaiEmbeddingResponseSchema } from './schemas.js';
import { EMBEDDING_DIMENSIONS } from './constants.js';

function dummyVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);
}

describe('openaiEmbeddingResponseSchema', () => {
  it('accepts a well-formed single-input response', () => {
    const parsed = openaiEmbeddingResponseSchema.parse({
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: dummyVector() }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('rejects an embedding with the wrong length', () => {
    expect(() =>
      openaiEmbeddingResponseSchema.parse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    ).toThrow();
  });

  it('rejects non-number elements in embedding', () => {
    const v = dummyVector();
    v[0] = 'oops' as unknown as number;
    expect(() =>
      openaiEmbeddingResponseSchema.parse({
        data: [{ embedding: v }],
      }),
    ).toThrow();
  });
});
