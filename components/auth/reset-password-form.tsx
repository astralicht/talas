'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, apiRequest } from '@/lib/http/client';
import { AuthCard, FormError, FormNotice } from './auth-card';

export function ResetPasswordForm() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') ?? '');
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      setNotice('Password updated. All active sessions were signed out. You can sign in now.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The reset failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="This link works once. Completing the reset signs out every active session."
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <p className="text-sm text-slate-600">Open the reset link from your email to continue.</p>
      ) : null}
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-slate-800">
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500">Use at least 12 characters.</p>
        </div>
        <FormError message={error} />
        <FormNotice message={notice} />
        <button
          type="submit"
          disabled={pending || !token}
          className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthCard>
  );
}
