'use server';

import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { loadEnv } from '@/lib/env.js';

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['reader', 'editor', 'admin']),
  publication_id: z.string().uuid(),
});

export type InviteResult = { ok: true; invitation_id: string } | { ok: false; error: string };

export async function inviteUserAction(input: {
  email: string;
  role: string;
  publication_id: string;
}): Promise<InviteResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const payload = {
    email: parsed.data.email.toLowerCase(),
    role: parsed.data.role,
    publication_id: parsed.data.publication_id,
  };

  const env = loadEnv();
  const supabase = await getSupabaseServerClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { ok: false, error: 'unauthenticated' };

  let response: Response;
  try {
    response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/invite-user`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('inviteUserAction: fetch failed', message);
    return { ok: false, error: 'network_error' };
  }

  let body: { ok?: boolean; invitation_id?: string; error?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, error: 'invalid_response' };
  }

  if (!response.ok || !body.ok || !body.invitation_id) {
    return { ok: false, error: body.error ?? 'invite_failed' };
  }
  return { ok: true, invitation_id: body.invitation_id };
}
