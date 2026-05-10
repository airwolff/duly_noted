'use client';
// client: interactive form, calls supabase.auth.signInWithOtp from browser

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@duly-noted/db';
import { sanitizeRedirectTo } from '@/lib/redirect-to.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirectTo(searchParams.get('redirectTo'));
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    setErrorMessage('');

    const supabase = createBrowserClient({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
    });
    const callbackUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`
        : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });

    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
      return;
    }
    setStatus('sent');
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Send magic link'}
        </button>
      </form>
      {status === 'sent' && <p className="mt-4">Check your email for a sign-in link.</p>}
      {status === 'error' && (
        <p className="mt-4 text-red-700">Could not send link: {errorMessage}</p>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
