import Anthropic, {
  APIConnectionError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';

/**
 * Thin wrapper around the Anthropic SDK that issues a single structured-output
 * call (ADR 0018: native `output_config.format`, no instructor-style
 * post-processing). Returns the parsed JSON as `unknown` so the caller is
 * forced to Zod-validate before any DB write per CLAUDE.md §6.
 *
 * Implements SPEC §Stage 4's retry policy — three retries with exponential
 * backoff (1s, 4s, 16s) scoped to transient errors only: connection errors
 * (incl. timeout subclass), 5xx, and 429. Auth/4xx/parse errors propagate
 * immediately. The Anthropic SDK is configured with `maxRetries: 0` so its
 * own retry behavior does not stack on top.
 */

export interface CallStructuredArgs {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Readonly<Record<string, unknown>>;
  maxTokens?: number;
}

export type CallStructured = (args: CallStructuredArgs) => Promise<unknown>;

const MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4096;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetriable(err: unknown): boolean {
  return (
    err instanceof APIConnectionError ||
    err instanceof InternalServerError ||
    err instanceof RateLimitError
  );
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetriable(err)) throw err;
      lastErr = err;
      if (attempt === RETRY_DELAYS_MS.length) break;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

/**
 * Build a CallStructured function bound to a given API key. The factory
 * shape is what gets injected into the segmentation handler's deps so tests
 * can substitute a stub implementation directly.
 */
export function createAnthropicCaller(apiKey: string): CallStructured {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return async function callStructured(args: CallStructuredArgs): Promise<unknown> {
    return withRetry(async () => {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: args.systemPrompt,
        messages: [{ role: 'user', content: args.userPrompt }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: args.jsonSchema,
          },
        },
      });
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error(
          `anthropic response missing text block (stop_reason=${String(response.stop_reason)})`,
        );
      }
      return JSON.parse(textBlock.text) as unknown;
    });
  };
}
