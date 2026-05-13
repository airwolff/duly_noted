// Supabase Edge Function: admin-only invite-user.
// Runs at: ${SUPABASE_URL}/functions/v1/invite-user
//
// Called directly from the browser by the admin invite form
// (apps/web/src/app/[publication]/admin/members/invite-form.tsx),
// so this function handles the CORS preflight OPTIONS request and
// includes Access-Control-Allow-* headers on every response.
//
// JWT verification is performed at the gateway (verify_jwt = true is
// declared in supabase/config.toml; explicit for the user-facing
// admin contract). The caller's JWT is forwarded to a user-scoped
// supabase-js client so PostgREST runs the admin re-check under the
// caller's role and Slice 5 RLS gates the read. Privileged work
// (insert into invitations, auth.admin.inviteUserByEmail) runs through
// a separate service-role client; SUPABASE_SERVICE_ROLE_KEY is held
// only by Edge Functions and the worker, never by apps/web (CLAUDE.md
// §6 cross-surface lock).
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

// @deno-types="npm:zod@3.23.8"
import { z } from 'https://esm.sh/zod@3.23.8';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`invite-user: required env var ${name} is missing`);
  }
  return value;
}

const env = {
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
};

const requestSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['reader', 'editor', 'admin']),
  publication_id: z.string().uuid(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // Gateway already verified the JWT. We need the header to forward to
  // the user-scoped supabase client for the admin re-check.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`invite-user: bad request: ${message}`);
    return jsonResponse({ error: 'bad_request' }, 400);
  }
  const email = payload.email.toLowerCase();
  const { role, publication_id } = payload;

  // 1. Re-verify caller is admin of the requested publication via a
  //    user-scoped client. RLS scopes memberships to auth.uid().
  const userClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: membership, error: membershipError } = await userClient
    .from('memberships')
    .select('role')
    .eq('publication_id', publication_id)
    .eq('role', 'admin')
    .maybeSingle();
  if (membershipError) {
    console.error(`invite-user: admin re-check failed: ${membershipError.message}`);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
  if (!membership) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  // 2. Service-role client for privileged work.
  const adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Conflict pre-check via SECURITY DEFINER helper RPC. The RPC reads
  //    auth.users to detect "already a member" without exposing the
  //    auth schema to PostgREST.
  const { data: conflict, error: conflictError } = await adminClient.rpc('check_invite_conflicts', {
    p_email: email,
    p_publication_id: publication_id,
  });
  if (conflictError) {
    console.error(`invite-user: conflict check failed: ${conflictError.message}`);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
  if (conflict === 'already_member') {
    return jsonResponse({ error: 'already_member' }, 409);
  }
  if (conflict === 'invitation_pending') {
    return jsonResponse({ error: 'invitation_pending' }, 409);
  }

  // 4. Identify the inviter for invited_by_user_id audit trail.
  const { data: callerData } = await userClient.auth.getUser();
  const inviterId = callerData.user?.id ?? null;

  // 5. Insert invitation row first so the trigger has something to
  //    resolve when inviteUserByEmail creates the auth.users row.
  const { data: invitation, error: insertError } = await adminClient
    .from('invitations')
    .insert({ email, role, publication_id, invited_by_user_id: inviterId })
    .select('id')
    .single();
  if (insertError) {
    console.error(`invite-user: invitation insert failed: ${insertError.message}`);
    return jsonResponse({ error: 'insert_failed' }, 500);
  }

  // 6. Call inviteUserByEmail. On failure, mark invitation revoked so
  //    the partial unique index does not block a retry.
  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);
  if (inviteError) {
    console.error(`invite-user: vendor invite failed, revoking invitation: ${inviteError.message}`);
    await adminClient
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', invitation.id);
    return jsonResponse({ error: 'invite_failed', detail: inviteError.message }, 502);
  }

  return jsonResponse({ ok: true, invitation_id: invitation.id }, 200);
});
