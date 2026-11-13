'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest, setCsrfToken } from '@/lib/http/client';
import { AuthCard, FormError } from './auth-card';

interface LoginResponse {
  user: { id: string; email: string; emailVerified: boolean };
  csrfToken?: string;
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function destination(): string {
    if (typeof window === 'undefined') return '/dashboard';
    const next = new URLSearchParams(window.location.search).get('next');
    // Same-origin paths only: a leading `/` that is followed by another `/` is
    // protocol-relative (`//evil.example`) and must never become the redirect
    // target of a signed-in navigation.
    return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await apiRequest<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      if (result.csrfToken) setCsrfToken(result.csrfToken);
      router.push(destination());
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign in failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      description="Continue to your personal workspace."
      footer={
        <>
          <div className="flex flex-wrap justify-between gap-2">
            <Link href="/register" className="font-medium text-brand-600 hover:underline">
              Create an account
            </Link>
            <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline">
              Forgot password?
            </Link>
          </div>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
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
            className="w-full rounded-md border border-input px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-input px-3 py-2 text-sm"
          />
        </div>
        <FormError message={error} />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}
