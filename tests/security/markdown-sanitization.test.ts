import { describe, expect, it } from 'vitest';
import { sanitizeHtml, sanitizeMarkdown, sanitizeLessonContent, isSafeUrl } from '@/lib/security/sanitize';

describe('Markdown sanitization on save and render', () => {
  it('removes script and dangerous elements while keeping safe Markdown', () => {
    const dirty = [
      '# Title',
      '',
      '<script>alert("xss")</script>',
      '<iframe src="https://evil.example"></iframe>',
      '<object></object>',
      'Safe paragraph with **bold** text.',
    ].join('\n');
    const safe = sanitizeMarkdown(dirty);

    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('<iframe');
    expect(safe).not.toContain('<object');
    expect(safe).toContain('# Title');
    expect(safe).toContain('**bold**');
  });

  it('strips inline event handlers from raw HTML', () => {
    const safe = sanitizeMarkdown('Click <img src="x.png" onerror="alert(1)">here');
    expect(safe).not.toContain('onerror');
    expect(safe).not.toContain('alert(1)');
  });

  it('neutralizes javascript: and data: URLs in links and images', () => {
    const safe = sanitizeMarkdown(
      '[click](javascript:alert(1)) ![pic](data:image/svg+xml;base64,AAAA) <a href="vbscript:msgbox">x</a>',
    );
    expect(safe).not.toMatch(/javascript:/i);
    expect(safe).not.toMatch(/data:/i);
    expect(safe).not.toMatch(/vbscript/i);
  });

  it('preserves allowed URL schemes', () => {
    const safe = sanitizeMarkdown('[docs](https://example.com) [mail](mailto:a@b.c) **bold**');
    expect(safe).toContain('https://example.com');
    expect(safe).toContain('mailto:a@b.c');
  });

  it('does not leak raw HTML through HTML entities bypass attempts', () => {
    const safe = sanitizeMarkdown('<scr<script>ipt>alert(1)</script>');
    expect(safe.toLowerCase()).not.toContain('<script');
  });

  it('is idempotent — re-sanitizing sanitized content changes nothing', () => {
    const dirty = '[x](javascript:alert(1)) <b onmouseover=alert(2)>t</b> **ok**';
    expect(sanitizeMarkdown(sanitizeMarkdown(dirty))).toBe(sanitizeMarkdown(dirty));
  });

  it('sanitizes generated lesson content the same way', () => {
    expect(sanitizeLessonContent('<script>x</script>**safe**')).toBe(sanitizeMarkdown('<script>x</script>**safe**'));
  });
});

describe('URL scheme allowlist', () => {
  it('allows http, https, mailto, and fragments', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeUrl('#anchor')).toBe(true);
    expect(isSafeUrl('/relative')).toBe(true);
  });

  it('rejects other schemes and unparseable values', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,x')).toBe(false);
    expect(isSafeUrl('vbscript:x')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });
});

describe('HTML sanitization for rendered output', () => {
  it('forbids scripts, styles, and event attributes', () => {
    const html = sanitizeHtml('<p onclick="x()">a</p><script>b</script><style>c</style>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).toContain('<p');
  });
});
