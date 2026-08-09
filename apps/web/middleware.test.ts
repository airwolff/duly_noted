// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@duly-noted/db', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));
vi.mock('@/lib/env.js', () => ({
  loadEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  }),
}));

beforeEach(() => {
  vi.resetModules();
});

describe('middleware', () => {
  it('redirects unauthenticated admin requests to /login with redirectTo preserved', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');
    const req = new NextRequest('http://localhost/midcoast-villager/admin/members');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location')!;
    const url = new URL(location);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe('/midcoast-villager/admin/members');
  });

  it('preserves the query string in redirectTo', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');
    const req = new NextRequest('http://localhost/pub/admin/members?tab=pending');
    const res = await middleware(req);
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('redirectTo')).toBe('/pub/admin/members?tab=pending');
  });

  // ADR 0024: reader routes are no longer gated by the middleware. An
  // anonymous visitor reaches the page and RLS decides what they see —
  // rows for publications flagged `public_read`, otherwise nothing.
  it('passes through unauthenticated reader routes', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');
    for (const path of [
      '/',
      '/midcoast-villager',
      '/midcoast-villager/lincolnville',
      '/midcoast-villager/lincolnville/select-board',
      '/midcoast-villager/lincolnville/select-board/6796cf74-170e-4a51-b268-01e8e064d0dc',
      '/midcoast-villager/search?q=harbor',
    ]) {
      const res = await middleware(new NextRequest(`http://localhost${path}`));
      expect(res.headers.get('location'), `expected pass-through for ${path}`).toBeNull();
    }
  });

  // Guards the boundary: only the `admin` segment directly under a
  // publication slug is gated. A town or board that happens to be named
  // "admin" sits one segment deeper and stays a reader route.
  it('gates only /{publication}/admin, not deeper look-alike segments', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');

    const gated = await middleware(new NextRequest('http://localhost/pub/admin'));
    expect(new URL(gated.headers.get('location')!).pathname).toBe('/login');

    const notGated = await middleware(new NextRequest('http://localhost/pub/town/admin'));
    expect(notGated.headers.get('location')).toBeNull();
  });

  it('passes through requests to /login itself', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');
    const req = new NextRequest('http://localhost/login');
    const res = await middleware(req);
    expect(res.headers.get('location')).toBeNull();
  });

  it('passes through requests to /auth/callback', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');
    const req = new NextRequest('http://localhost/auth/callback?code=abc');
    const res = await middleware(req);
    expect(res.headers.get('location')).toBeNull();
  });
});
