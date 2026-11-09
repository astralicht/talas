import * as React from 'react';

export function VerifyEmailEmail({ url }: { url: string }): React.ReactElement {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0f172a', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 22 }}>Verify your Talas email</h1>
      <p>Confirm your email address to unlock uploads and lesson generation.</p>
      <p>
        <a
          href={url}
          style={{
            display: 'inline-block',
            background: '#2f5ad0',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: 6,
            textDecoration: 'none',
          }}
        >
          Verify email
        </a>
      </p>
      <p>This link expires in 24 hours. If you did not create an account, ignore this email.</p>
      <p style={{ color: '#475569', fontSize: 12 }}>{url}</p>
    </div>
  );
}

export function verifyEmailText(url: string): string {
  return `Verify your Talas email\n\nOpen this link to verify your account (expires in 24 hours):\n${url}\n\nIf you did not create an account, ignore this email.`;
}
