/**
 * Sanitize a `redirectTo` query-param value. Only same-origin absolute
 * paths (starting with a single `/`) are permitted. Anything else
 * collapses to `/` so an attacker cannot smuggle off-origin redirects
 * through the auth flow.
 */
export function sanitizeRedirectTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}
