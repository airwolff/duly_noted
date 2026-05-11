import { EMBEDDING_MODEL, openaiEmbeddingResponseSchema } from '@duly-noted/shared';

/**
 * Fetch-based wrapper around the OpenAI embeddings endpoint. Returns one
 * 1536-dim vector per input string, preserving input order. Implements
 * SPEC §Stage 9 / ADR 0022 retry policy: three retries with exponential
 * backoff (1s, 4s, 16s) scoped to transient errors only (429, 5xx,
 * network failures). Auth/4xx and parse errors propagate immediately.
 *
 * Honors `retry-after` headers when present on 429 responses by delaying
 * at least that long before the next attempt.
 *
 * Response shape is Zod-validated (length check enforced via the shared
 * schema's `.length(1536)`) before return; the caller never sees an
 * untrusted shape per CLAUDE.md §6.
 */

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_RETRY_DELAYS_MS = [1000, 4000, 16000];

export type CallEmbedder = (inputs: string[]) => Promise<number[][]>;

export interface OpenAIEmbedderOptions {
  retryDelaysMs?: number[];
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const asNum = Number(header);
  if (!Number.isNaN(asNum) && asNum >= 0) return asNum * 1000;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export function createOpenAIEmbedder(
  apiKey: string,
  options: OpenAIEmbedderOptions = {},
): CallEmbedder {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  return async function embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(OPENAI_EMBEDDINGS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: inputs,
          }),
        });
      } catch (err) {
        lastErr = err;
        if (attempt === retryDelaysMs.length) break;
        await sleep(retryDelaysMs[attempt] ?? 0);
        continue;
      }

      if (response.ok) {
        const json: unknown = await response.json();
        const parsed = openaiEmbeddingResponseSchema.parse(json);
        if (parsed.data.length !== inputs.length) {
          throw new Error(
            `openai embeddings: expected ${inputs.length} vectors, got ${parsed.data.length}`,
          );
        }
        return parsed.data.map((d) => d.embedding);
      }

      if (!isRetriableStatus(response.status)) {
        const text = await response.text().catch(() => '');
        throw new Error(`openai embeddings: ${response.status} ${text}`);
      }

      // retriable status — set up next attempt
      const text = await response.text().catch(() => '');
      lastErr = new Error(`openai embeddings: ${response.status} ${text}`);
      if (attempt === retryDelaysMs.length) break;
      const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
      const baseDelay = retryDelaysMs[attempt] ?? 0;
      await sleep(retryAfter !== null ? Math.max(retryAfter, baseDelay) : baseDelay);
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
}
