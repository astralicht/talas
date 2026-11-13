'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, apiRequest } from '@/lib/http/client';
import { AuthCard, FormError, FormNotice } from './auth-card';
import { InlineSpinner } from '@/components/ui/spinner';

export function VerifyEmailClient() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'verifying' | 'verified' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    setEmail(params.get('email') ?? '');
  }, []);

  useEffect(() => {
    if (!token || state !== 'idle') return;
    setState('verifying');
    apiRequest('/api/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => {
        setState('verified');
        setMessage('Your email is verified. You can now upload study material.');
      })
      .catch((cause: unknown) => {
        setState('failed');
        setMessage(
          cause instanceof ApiError
            ? cause.message
            : 'This verification link is invalid or has expired.',
        );
      });
  }, [token, state]);

  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendNotice(null);
    setResending(true);
    try {
      await apiRequest('/api/auth/resend-verification', { method: 'POST', body: { email } });
      setResendNotice('If the account exists and is unverified, a new link is on its way.');
    } catch (cause) {
      setResendNotice(cause instanceof ApiError ? cause.message : 'The request failed.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthCard
      title="Verify your email"
      description="Verification unlocks uploads and lesson generation."
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Continue to sign in
        </Link>
      }
    >
      <div className="space-y-4">
        {state === 'verifying' ? <p className="text-sm text-muted-foreground">Verifying…</p> : null}
        <FormNotice message={state === 'verified' ? message : null} />
        <FormError message={state === 'failed' ? message : null} />
        {!token && state !== 'verified' ? (
          <p className="text-sm text-muted-foreground">
            Open the link from your verification email, or request a new one below.
          </p>
        ) : null}
        <form className="space-y-3" onSubmit={resend}>
          <div className="space-y-1">
            <label htmlFor="resend-email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="resend-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-input px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={resending}
            aria-busy={resending}
            className="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            {resending ? <InlineSpinner label="Resending…" /> : 'Resend verification email'}
          </button>
        </form>
        <FormNotice message={resendNotice} />
      </div>
    </AuthCard>
  );
}
