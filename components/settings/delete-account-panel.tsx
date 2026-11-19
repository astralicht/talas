'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest, setCsrfToken } from '@/lib/http/client';
import { Button } from '@/components/ui/button';

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
      <p className="text-muted-foreground text-sm">
        Deleting your account ends access immediately and removes your materials, lessons, and
        revisions. This cannot be undone.
      </p>
      <div className="space-y-1">
        <label htmlFor="delete-confirmation" className="text-foreground text-sm font-medium">
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="border-input w-full max-w-xs rounded-lg border px-3 py-2 text-sm"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="danger"
        disabled={pending}
        className="border-red-600 text-red-700 dark:text-red-300"
      >
        {pending ? 'Deleting…' : 'Delete account'}
      </Button>
    </form>
  );
}
