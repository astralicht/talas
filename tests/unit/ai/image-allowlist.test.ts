import { describe, expect, it } from 'vitest';
import { buildImageUrl, sanitizeGeneratedImages } from '@/lib/ai/images';

describe('generated-image allowlist (FR-008)', () => {
  const allowed = ['/api/materials/m1/images/a1', '/api/materials/m1/images/a2'];

  it('builds tenant-scoped cookie-authenticated catalog URLs', () => {
    expect(buildImageUrl('m1', 'a1')).toBe('/api/materials/m1/images/a1');
  });

  it('keeps catalog-referenced markdown images', () => {
    const markdown = 'Intro\n\n![Figure](/api/materials/m1/images/a1)\n\nOutro';
    expect(sanitizeGeneratedImages(markdown, allowed)).toBe(markdown);
  });

  it('keeps catalog-referenced raw img tags', () => {
    const markdown = 'Intro <img src="/api/materials/m1/images/a2" alt="f"> end';
    expect(sanitizeGeneratedImages(markdown, allowed)).toBe(markdown);
  });

  it('strips fabricated, external, protocol-relative, and data URLs', () => {
    const markdown = [
      '![fabricated](/api/materials/m9/images/zzz)',
      '![external](https://evil.example/pixel.png)',
      '![protocol-relative](//evil.example/pixel.png)',
      '![data](data:image/png;base64,AAAA)',
      '![kept](/api/materials/m1/images/a1)',
    ].join('\n');
    const sanitized = sanitizeGeneratedImages(markdown, allowed);
    expect(sanitized).toContain('![kept](/api/materials/m1/images/a1)');
    expect(sanitized).not.toContain('evil.example');
    expect(sanitized).not.toContain('data:image');
    expect(sanitized).not.toContain('m9/images/zzz');
  });

  it('strips raw img tags with non-catalog sources', () => {
    const markdown = '<img src="https://evil.example/x.png"> text <img src="/api/materials/m1/images/a2">';
    const sanitized = sanitizeGeneratedImages(markdown, allowed);
    expect(sanitized).not.toContain('evil.example');
    expect(sanitized).toContain('/api/materials/m1/images/a2');
  });
});
