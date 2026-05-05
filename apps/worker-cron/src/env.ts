import { z } from 'zod';
import { createEnvValidator } from '@duly-noted/shared';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  YOUTUBE_API_KEY: z.string().min(1).optional(),
});

export type WorkerCronEnv = z.infer<typeof schema>;

export function loadEnv(): WorkerCronEnv {
  return createEnvValidator(schema, { appName: 'worker-cron' });
}
