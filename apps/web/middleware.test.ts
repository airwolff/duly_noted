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
  it('redirects unauthenticated requests to /login with redirectTo preserved', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');
    const req = new NextRequest('http://localhost/midcoast-villager/lincolnville');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location')!;
    const url = new URL(location);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe('/midcoast-villager/lincolnville');
  });

  it('preserves the query string in redirectTo', async () => {
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('./middleware.js');
    const req = new NextRequest('http://localhost/foo?bar=baz');
    const res = await middleware(req);
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('redirectTo')).toBe('/foo?bar=baz');
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
