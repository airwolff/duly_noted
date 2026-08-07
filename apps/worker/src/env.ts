import { z } from 'zod';
import { createEnvValidator } from '@duly-noted/shared';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASR_VENDOR_API_KEY: z.string().min(1),
  ASR_WEBHOOK_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // ADR 0019: residential proxy for yt-dlp egress. Optional so local dev on a
  // residential IP needs no proxy account; the worker warns loudly at boot when
  // it is unset, because unset in production means every extraction 429s.
  YT_DLP_PROXY_URL: z.string().url().optional(),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(): WorkerEnv {
  return createEnvValidator(schema, { appName: 'worker' });
}
