'use client';
// client: form interactivity, calls supabase.auth.getSession from browser,
// posts directly to invite-user Edge Function. Server Actions are avoided
// because @cloudflare/next-on-pages does not reliably bundle Server Action
// POST handlers (see apps/web/CLAUDE.md §3).

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@duly-noted/db';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

type Role = 'reader' | 'editor' | 'admin';

interface InviteResponse {
  ok?: boolean;
  invitation_id?: string;
  error?: string;
}

function describeError(code: string): string {
  switch (code) {
    case 'already_member':
      return 'That email is already a member of this publication.';
    case 'invitation_pending':
      return 'An open invitation already exists for that email.';
    case 'forbidden':
      return 'You do not have permission to invite members.';
    case 'unauthenticated':
      return 'Your session has expired. Sign in again.';
    case 'network_error':
      return 'Could not reach the server. Check your connection and retry.';
    default:
      return `Invite failed: ${code}`;
  }
}

export function InviteForm({ publicationId }: { publicationId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('reader');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    setMessage('');

    const supabase = createBrowserClient({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
    });
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      setStatus('error');
      setMessage(describeError('unauthenticated'));
      return;
    }

    let response: Response;
    try {
      response = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: email.toLowerCase(),
          role,
          publication_id: publicationId,
        }),
      });
    } catch {
      setStatus('error');
      setMessage(describeError('network_error'));
      return;
    }

    let body: InviteResponse = {};
    try {
      body = (await response.json()) as InviteResponse;
    } catch {
      setStatus('error');
      setMessage(describeError('invalid_response'));
      return;
    }

    if (!response.ok || !body.ok || !body.invitation_id) {
      setStatus('error');
      setMessage(describeError(body.error ?? 'invite_failed'));
      return;
    }

    setStatus('sent');
    setMessage('Invitation sent.');
    setEmail('');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <label className="block">
        <span className="block text-sm font-medium">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={status === 'sending'}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium">Role</span>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          disabled={status === 'sending'}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
        >
          <option value="reader">Reader</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={status === 'sending'}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {status === 'sending' ? 'Sending…' : 'Send invitation'}
      </button>
      {message && (
        <p className={status === 'error' ? 'text-red-700' : 'text-emerald-700'}>{message}</p>
      )}
    </form>
  );
}
