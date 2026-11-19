'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, setCsrfToken } from '@/lib/http/client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
