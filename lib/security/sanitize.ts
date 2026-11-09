import DOMPurify from 'isomorphic-dompurify';

export const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto'] as const;

const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|#|\/|\.\/|\.\.\/)/i;

const DANGEROUS_TAGS = /<\/?(?:script|style|iframe|object|embed|form|input|button|link|meta)\b[^>]*>/gi;
const EVENT_HANDLER_ATTRIBUTES = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL_SCHEME =
  /(javascript|vbscript|data)\s*:/gi;

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./')) return true;
  try {
    const parsed = new URL(trimmed);
    return (ALLOWED_URL_SCHEMES as readonly string[]).includes(parsed.protocol.replace(':', ''));
  } catch {
    return false;
  }
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
    USE_PROFILES: { html: true },
  });
}

/**
 * Sanitizes Markdown before persistence while preserving safe Markdown syntax.
 * Raw HTML event handlers, dangerous elements, and unsafe link schemes are removed.
 */
/**
 * Repeats the strip pass until the output no longer changes, defeating
 * nested-tag reassembly like `<scr<script>ipt>` which reconstructs a live
 * `<script>...</script>` tag from leftovers after a single pass.
 */
function stripOnce(value: string): string {
  let safe = value.replace(DANGEROUS_TAGS, '');
  safe = safe.replace(EVENT_HANDLER_ATTRIBUTES, '');

  // Markdown inline/reference destinations: [text](javascript:...) and ![alt](data:...)
  safe = safe.replace(
    /(!?\[[^\]]*\]\()\s*((?:javascript|vbscript|data)\s*:[^)]*)\)/gi,
    '$1#)',
  );

  // Raw HTML href/src destinations.
  safe = safe.replace(
    /\b(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data)\s*:[^"']*\2/gi,
    '$1="#"',
  );

  // Autolinks and bare dangerous schemes left as text are neutralized.
  safe = safe.replace(DANGEROUS_URL_SCHEME, (match) => `${match[0]}​${match.slice(1)}`);
  return safe;
}

export function sanitizeMarkdown(markdown: string): string {
  let safe = markdown;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = stripOnce(safe);
    if (next === safe) return safe;
    safe = next;
  }
  return safe;
}

export function sanitizeLessonContent(markdown: string): string {
  return sanitizeMarkdown(markdown);
}
