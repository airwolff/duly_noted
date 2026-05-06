import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@duly-noted/db';
import { loadEnv } from '@/lib/env.js';

export async function middleware(request: NextRequest) {
  const env = loadEnv();
  const response = NextResponse.next({ request });

  const supabase = createServerClient({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    cookies: {
      getAll: () =>
        request.cookies.getAll().map((cookie) => ({ name: cookie.name, value: cookie.value })),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set({ name, value, ...options });
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
