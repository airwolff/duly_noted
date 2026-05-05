import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';

export interface ServiceClientConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

/**
 * Server-only Supabase client with service-role privileges.
 *
 * MUST NOT be imported from `apps/web` — service-role bypasses RLS.
 * Only `apps/worker` and `apps/worker-cron` may use this.
 */
export function createServiceClient(config: ServiceClientConfig): SupabaseClient<Database> {
  if (!config.serviceRoleKey) {
    throw new Error(
      'createServiceClient: serviceRoleKey is required. ' +
        'This client must only be used from server-side worker processes.',
    );
  }
  return createClient<Database>(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
