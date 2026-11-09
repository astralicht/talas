const isProduction = process.env.NODE_ENV === 'production';

/** Hardening headers applied to every middleware response, including redirects and preflights. */
export function securityHeaders(): Record<string, string> {
  return {
    'Strict-Transport-Security': isProduction
      ? 'max-age=15552000; includeSubDomains; preload'
      : 'max-age=15552000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
