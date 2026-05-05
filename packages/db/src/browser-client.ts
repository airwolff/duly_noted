import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';

export interface BrowserClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function createBrowserClient(config: BrowserClientConfig): SupabaseClient<Database> {
  return createSupabaseBrowserClient<Database>(config.supabaseUrl, config.supabaseAnonKey);
}
