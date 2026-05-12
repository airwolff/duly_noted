'use client';
// client: form interactivity, server-action invocation

import { useState, type FormEvent } from 'react';
import { inviteUserAction } from './actions.js';

type Role = 'reader' | 'editor' | 'admin';

export function InviteForm({ publicationId }: { publicationId: string }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('reader');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    setMessage('');
    const result = await inviteUserAction({ email, role, publication_id: publicationId });
    if (!result.ok) {
      setStatus('error');
      setMessage(
        result.error === 'already_member'
          ? 'That email is already a member of this publication.'
          : result.error === 'invitation_pending'
            ? 'An open invitation already exists for that email.'
            : result.error === 'forbidden'
              ? 'You do not have permission to invite members.'
              : `Invite failed: ${result.error}`,
      );
      return;
    }
    setStatus('sent');
    setMessage('Invitation sent.');
    setEmail('');
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
