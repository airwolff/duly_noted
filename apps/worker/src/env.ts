import { z } from 'zod';
import { createEnvValidator } from '@duly-noted/shared';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASR_VENDOR_API_KEY: z.string().min(1),
  ASR_WEBHOOK_SECRET: z.string().min(1),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(): WorkerEnv {
  return createEnvValidator(schema, { appName: 'worker' });
}
