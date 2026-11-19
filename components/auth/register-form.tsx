'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';
import { Button } from '@/components/ui/button';
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
          <Link href="/login" className="text-brand-700 font-medium hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1">
          <label htmlFor="email" className="text-foreground text-sm font-medium">
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
            className="border-input w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-foreground text-sm font-medium">
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
            className="border-input w-full rounded-md border px-3 py-2 text-sm"
          />
          <p id="password-help" className="text-muted-foreground text-xs">
            Use at least 12 characters.
          </p>
        </div>
        <FormError message={error} />
        <FormNotice message={notice} />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
