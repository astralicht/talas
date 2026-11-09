'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';
import { AuthCard, FormError, FormNotice } from './auth-card';

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await apiRequest('/api/auth/register', {
        method: 'POST',
        body: { email, password },
      });
      setNotice('Account created. Check your inbox for the verification link.');
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Registration failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      description="Secure your workspace with an email address and a strong password."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-slate-800">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-slate-800">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="password-help"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <p id="password-help" className="text-xs text-slate-500">
            Use at least 12 characters.
          </p>
        </div>
        <FormError message={error} />
        <FormNotice message={notice} />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}
