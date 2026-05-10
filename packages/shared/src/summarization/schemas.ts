import { z } from 'zod';
import { SUMMARY_MAX_CHARS, SUMMARY_MIN_CHARS } from './constants.js';

/**
 * Slice 4 summarization output shape. Anthropic native structured outputs
 * (ADR 0018) constrain the response to `{ summary: string }`; Zod validates
 * the parsed object before any DB write per CLAUDE.md §6 (LLM output is
 * untrusted input). minLength/maxLength are absent from the JSON schema —
 * Anthropic does not honor them; Zod is the only enforcement surface for
 * length bounds.
 */

export const summaryJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
  },
  required: ['summary'],
  additionalProperties: false,
} as const;

export const summaryOutputSchema = z.object({
  summary: z.string().min(SUMMARY_MIN_CHARS).max(SUMMARY_MAX_CHARS),
});

export type SummaryOutput = z.infer<typeof summaryOutputSchema>;
