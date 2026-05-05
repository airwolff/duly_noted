import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.js';

export interface CookieRecord {
  name: string;
  value: string;
}

export interface CookieOptions {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

export interface ServerClientCookieAdapter {
  getAll: () => CookieRecord[] | Promise<CookieRecord[]>;
  setAll: (cookies: CookieOptions[]) => void | Promise<void>;
}

export interface ServerClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  cookies: ServerClientCookieAdapter;
}

export function createServerClient(config: ServerClientConfig): SupabaseClient<Database> {
  return createSupabaseServerClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: config.cookies,
  });
}
