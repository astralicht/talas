import * as React from 'react';

export function ResetPasswordEmail({ url }: { url: string }): React.ReactElement {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0f172a', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 22 }}>Reset your Talas password</h1>
      <p>Use the button below to choose a new password. This link works once and expires in 30 minutes.</p>
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
          Reset password
        </a>
      </p>
      <p>Completing the reset signs you out of every active session.</p>
      <p>If you did not request a reset, ignore this email.</p>
      <p style={{ color: '#475569', fontSize: 12 }}>{url}</p>
    </div>
  );
}

export function resetPasswordText(url: string): string {
  return `Reset your Talas password\n\nOpen this link to choose a new password (single use, expires in 30 minutes):\n${url}\n\nCompleting the reset signs you out of every active session. If you did not request a reset, ignore this email.`;
}
