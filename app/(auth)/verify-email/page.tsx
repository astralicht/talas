import type { Metadata } from 'next';
import { VerifyEmailClient } from '@/components/auth/verify-email-client';

export const metadata: Metadata = { title: 'Verify email' };

export default function VerifyEmailPage() {
  return <VerifyEmailClient />;
}
