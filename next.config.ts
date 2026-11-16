import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: isProduction
      ? 'max-age=15552000; includeSubDomains; preload'
      : 'max-age=15552000; includeSubDomains',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is opt-in: the Docker web image (infra/Dockerfile.web)
  // needs it, while local and test-harness builds skip the slow standalone
  // copy step (deep node_modules trees are expensive on Windows).
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  serverExternalPackages: [
    'argon2',
    'mongoose',
    'bullmq',
    'ioredis',
    'pdfjs-dist',
    'mammoth',
    'nodemailer',
    'pino',
    'isomorphic-dompurify',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
