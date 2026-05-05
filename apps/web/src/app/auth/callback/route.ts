import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server.js';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const target = new URL('/login', request.url);
    target.searchParams.set('error', error.message);
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
