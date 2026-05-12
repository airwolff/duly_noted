import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@duly-noted/db';
import { loadEnv } from '@/lib/env.js';

const PUBLIC_PATHS = ['/login', '/auth/callback'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const env = loadEnv();
  const response = NextResponse.next({ request });

  // Tracks whether the Supabase SSR helper wrote a session cookie whose
  // value differs from the request's incoming cookie — i.e., the token
  // actually rotated (or this is a first request with no prior cookie).
  // Used to gate resolve_pending_invitations() to the doc-described
  // "session establishment" cadence rather than firing per request.
  let sessionCookieRotated = false;

  const supabase = createServerClient({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    cookies: {
      getAll: () =>
        request.cookies.getAll().map((cookie) => ({ name: cookie.name, value: cookie.value })),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          if (request.cookies.get(name)?.value !== value) {
            sessionCookieRotated = true;
          }
          response.cookies.set({ name, value, ...options });
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (data.user) {
    // Slice 7: defense-in-depth for the case where the user already
    // existed in auth.users when an admin invited them (no INSERT
    // event for the trigger to fire on). Idempotent; no-op for users
    // with no open invitations. Logged but never blocks the request —
    // same posture as the trigger's RAISE WARNING wrapper. Gated on
    // session-cookie rotation so the RPC fires at most once per token
    // refresh interval (Supabase default 1h), not once per page load.
    if (sessionCookieRotated) {
      const { error: resolveError } = await supabase.rpc('resolve_pending_invitations');
      if (resolveError) {
        console.warn('middleware: resolve_pending_invitations failed', resolveError);
      }
    }
    return response;
  }
  if (isPublic(request.nextUrl.pathname)) return response;

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirectTo', request.nextUrl.pathname + request.nextUrl.search);
  // Preserve refreshed session cookies on the redirect response —
  // dropping `response.headers` is the documented Supabase-SSR gotcha
  // where the user bounces between /login and the target on every load.
  return NextResponse.redirect(loginUrl, { headers: response.headers });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
