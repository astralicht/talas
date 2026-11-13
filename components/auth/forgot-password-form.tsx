'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, apiRequest } from '@/lib/http/client';
import { AuthCard, FormError, FormNotice } from './auth-card';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      await apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setMessage(
        'If an account exists for that address, a single-use reset link is on its way. It expires in 30 minutes.',
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The request failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Forgot your password?"
      description="We will email a single-use link that expires in 30 minutes."
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-input px-3 py-2 text-sm"
          />
        </div>
        <FormError message={error} />
        <FormNotice message={message} />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthCard>
  );
}
