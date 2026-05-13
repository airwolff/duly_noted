# apps/web conventions

Web-app-specific rules. Repo-root `CLAUDE.md` covers cross-surface rules
(secrets, queue patterns, LLM-output validation); this file covers the
Next.js / Cloudflare Pages surface.

## 1. Server vs client components

- Server components by default. Add `"use client"` only when the
  component needs browser APIs, event handlers, or React state.
- Data fetching happens in server components via the Supabase SSR helper
  (`createServerClient` from `@supabase/ssr`). The browser
  Supabase client is for client components that need to react to auth
  state changes — not for general data fetching.
- The session cookie is the single source of authenticated identity at
  the web layer. Do not pass user IDs through query params or props;
  read them from `auth.uid()` inside RLS-filtered queries.

## 2. Routing

- App Router only. No `pages/` directory.
- Tenant-explicit URLs from day one (see SPEC.md §Stage 8). The
  publication slug is the first dynamic segment of every reader URL.
- Meeting routes use `meeting.id` (uuid), not a slug. Future date-based
  slugs are additive, not replacements.
- Auth routes (`/login`, `/auth/callback`) and Next.js asset paths are
  the only routes outside the auth gate. The middleware enforces this.
- Admin routes live under `/{publication.slug}/admin/*`. They require
  both an authenticated session (enforced by middleware) and an admin
  role membership for the requested publication (enforced by the page's
  server component; see §3). At Slice 7, only `/{publication.slug}/admin/members`
  ships. Other admin surfaces stay in Backlog B4.

## 3. Auth gate

- `apps/web/middleware.ts` refreshes the Supabase session cookie on every
  non-asset request and redirects unauthenticated requests to `/login`
  with the requested URL preserved as a `redirectTo` param.
- Middleware additionally calls `resolve_pending_invitations()` on
  session establishment (Slice 7+). The RPC is idempotent and no-ops
  for users with no matching open invitations; the call adds one
  round-trip on session-cookie-refresh transitions and is acceptable at
  v1 volume.
- Do not duplicate the auth check inside individual pages or layouts.
  The middleware is the single gate; pages assume an authenticated
  session.
- Pages or server actions that mutate publication-level state
  (invitations, member roles, settings, operator review) must
  additionally verify `admin` role membership against the requested
  publication before any side effect. The check is a server-side
  `SELECT 1 FROM memberships WHERE user_id = auth.uid() AND
publication_id = $? AND role = 'admin'`. RLS on the underlying
  tables is defense-in-depth; the explicit role check is the
  contract-level boundary. Non-admin authenticated users navigating
  to admin routes receive `notFound()` — the route surfaces as 404,
  indistinguishable from a route that doesn't exist.
- Client components in `apps/web` post directly to Supabase Edge
  Functions for mutating admin operations, attaching the JWT from
  `supabase.auth.getSession()` (via `createBrowserClient`) in the
  `Authorization: Bearer ...` header. The Edge Function calls the
  privileged Supabase admin API (`auth.admin.inviteUserByEmail`,
  `auth.admin.createUser`, etc.). The web app does not hold
  `SUPABASE_SERVICE_ROLE_KEY`; the boundary is locked in root
  `CLAUDE.md` §6.
- Do not use Next.js Server Actions for cross-surface mutating calls.
  The `@cloudflare/next-on-pages` adapter does not reliably bundle
  Server Action POST handlers — Slice 7 smoke testing surfaced a 404
  from Cloudflare Pages (`x-matched-path: /404`) on the Server Action
  POST for the invite form, with no request ever reaching the Edge
  Function. The Slice 7 invite form was rewritten as a client
  component that fetches the `invite-user` Edge Function directly;
  use that pattern (`apps/web/src/app/[publication]/admin/members/invite-form.tsx`)
  for any future admin mutation. After a successful mutation, call
  `useRouter().refresh()` from `next/navigation` to re-render the
  parent server component and pick up the new DB state.
- An authenticated session is not a sufficient authorization signal for
  any specific resource — RLS is the access boundary. Pages query and
  let the database return rows or not. A 404 from an RLS-hidden row is
  a feature, not an edge case.

## 4. Data fetching

- One server-component query per logical page concern. Use Supabase's
  related-table syntax (`select=*, segments(*)`) to fetch a meeting and
  its segments in one round trip rather than two.
- No client-side data fetching for the initial page render. Hydration
  receives data from the server component; client components handle
  post-render interactivity only.
- No caching layer at v1 beyond Next.js's default request-level
  memoization. Cloudflare Pages handles edge caching; introducing a
  separate cache layer is premature.

## 5. YouTube embed

- Per-segment `<iframe>` with `?start={seconds}` in the URL. Do NOT use
  the IFrame Player API for seek operations at v1 — the keyframe-aligned
  `?start=` parameter is the simpler and KB-justified path
  (`kb_video-timestamp-linking-ux`).
- The IFrame Player API IS used for one purpose only: listening for
  `onError` events to drive the B3 fallback. Wrap each iframe in a
  client component that handles error codes 100, 101, 150, 153 and
  renders the fallback panel.

## 6. Styling

- Tailwind utility classes are the default. Component-scoped CSS only
  when Tailwind cannot express the rule.
- No CSS-in-JS libraries. The Cloudflare Pages edge runtime constrains
  what runs at request time; keep styling static.

## 7. Out of scope at v1

- Public (unauthenticated) reader surface. Locked decision; do not build.
- Search UI. Slice 6.
- Admin UI for member list view, role changes, member removal,
  revoke/resend invitations, audit log of past invitations, operator
  review. The Slice 7 admin surface ships only an invite form and a
  pending-invitations list view under `/{publication.slug}/admin/members`;
  other admin operations stay in Backlog B4.
- Client-side state management libraries (Redux, Zustand). React state
  and URL state are sufficient at the v1 page surface.
