'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest, setCsrfToken } from '@/lib/http/client';

export function DeleteAccountPanel() {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== 'DELETE') {
      setError('Type DELETE to confirm.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await apiRequest('/api/account', { method: 'DELETE' });
      setCsrfToken(null);
      router.push('/login');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The request failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={onDelete}>
      <p className="text-sm text-slate-600">
        Deleting your account ends access immediately and removes your materials, lessons, and
        revisions. This cannot be undone.
      </p>
      <div className="space-y-1">
        <label htmlFor="delete-confirmation" className="text-sm font-medium text-slate-800">
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? 'Deleting…' : 'Delete account'}
      </button>
    </form>
  );
}
