import { z } from 'zod';
import { EMBEDDING_DIMENSIONS } from './constants.js';

/**
 * OpenAI embeddings response shape, narrowed to the fields the worker
 * and the Edge Function consume. Other fields (object, model, usage) are
 * permitted via passthrough.
 *
 * Per CLAUDE.md §6, every embedding's length is validated to equal the
 * configured dimension count before persistence — this schema is the
 * enforcement surface.
 */
export const openaiEmbeddingResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export type OpenAIEmbeddingResponse = z.infer<typeof openaiEmbeddingResponseSchema>;
