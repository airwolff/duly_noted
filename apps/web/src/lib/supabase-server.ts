import { cookies } from 'next/headers';
import { createServerClient } from '@duly-noted/db';
import { loadEnv } from '../../env.js';

export async function getSupabaseServerClient() {
  const env = loadEnv();
  const cookieStore = await cookies();

  return createServerClient({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    cookies: {
      getAll: () =>
        cookieStore.getAll().map((cookie) => ({ name: cookie.name, value: cookie.value })),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set({ name, value, ...options });
          }
        } catch {
          // Called from a Server Component — middleware refreshes the session.
        }
      },
    },
  });
}
