import { z } from 'zod';
import { MARKER_TYPES, type MarkerType } from './taxonomy.js';

/**
 * Step 1/2/3 LLM output shapes. Each step has a JSON Schema for Anthropic
 * native structured outputs (ADR 0018) and a matching Zod schema that
 * validates the parsed output before any DB write (CLAUDE.md §6: LLM output
 * is untrusted input). Constrained decoding guarantees shape; Zod guards the
 * write path; the T-token validator guards factual lookup correctness.
 */

const T_TOKEN_PATTERN = '^\\[T\\d+\\]$';

export const TITLE_MAX_LEN = 120;
export const DESCRIPTION_MAX_LEN = 500;

// --- Step 1: marker extraction --------------------------------------------

export const step1JsonSchema = {
  type: 'object',
  properties: {
    markers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          marker_type: { type: 'string', enum: [...MARKER_TYPES] },
          start_token: { type: 'string', pattern: T_TOKEN_PATTERN },
        },
        required: ['marker_type', 'start_token'],
        additionalProperties: false,
      },
    },
  },
  required: ['markers'],
  additionalProperties: false,
} as const;

const tTokenSchema = z.string().regex(/^\[T\d+\]$/);

export const step1OutputSchema = z.object({
  markers: z.array(
    z.object({
      marker_type: z.enum(MARKER_TYPES),
      start_token: tTokenSchema,
    }),
  ),
});

export type Step1Output = z.infer<typeof step1OutputSchema>;
export type Step1Marker = { marker_type: MarkerType; start_token: string };

// --- Step 2: chapter boundary determination -------------------------------

export const step2JsonSchema = {
  type: 'object',
  properties: {
    end_token: { type: 'string', pattern: T_TOKEN_PATTERN },
  },
  required: ['end_token'],
  additionalProperties: false,
} as const;

export const step2OutputSchema = z.object({
  end_token: tTokenSchema,
});

export type Step2Output = z.infer<typeof step2OutputSchema>;

// --- Step 3: title + description ------------------------------------------

export const step3JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: TITLE_MAX_LEN },
    description: { type: 'string', minLength: 1, maxLength: DESCRIPTION_MAX_LEN },
  },
  required: ['title', 'description'],
  additionalProperties: false,
} as const;

export const step3OutputSchema = z.object({
  title: z.string().min(1).max(TITLE_MAX_LEN),
  description: z.string().min(1).max(DESCRIPTION_MAX_LEN),
});

export type Step3Output = z.infer<typeof step3OutputSchema>;
