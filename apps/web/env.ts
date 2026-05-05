import { z } from 'zod';
import { createEnvValidator } from '@duly-noted/shared';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  ASR_WEBHOOK_SECRET: z.string().min(1),
});

export type WebEnv = z.infer<typeof schema>;

let cached: WebEnv | undefined;

export function loadEnv(): WebEnv {
  if (!cached) {
    cached = createEnvValidator(schema, { appName: 'web' });
  }
  return cached;
}
