import { describe, expect, it } from 'vitest';
import { emailSchema, objectIdSchema, paginationSchema, passwordSchema } from '@/lib/validation/common';
import { presignSchema } from '@/lib/validation/materials';
import { lessonSaveSchema } from '@/lib/validation/lessons';

describe('shared validation schemas', () => {
  it('rejects unknown keys on strict objects', () => {
    const result = presignSchema.safeParse({
      filename: 'notes.txt',
      declaredMime: 'text/plain',
      sizeBytes: 10,
      injected: 'field',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys on lesson saves', () => {
    const result = lessonSaveSchema.safeParse({
      version: 1,
      title: 'Title',
      contentMarkdown: '# hi',
      isAdmin: true,
    });
    expect(result.success).toBe(false);
  });

  it('bounds email length at 254 characters', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`;
    expect(emailSchema.safeParse(tooLong).success).toBe(false);
    expect(emailSchema.safeParse('someone@example.com').success).toBe(true);
    expect(emailSchema.safeParse('Someone@Example.COM').success).toBe(true);
  });

  it('requires a 12-character minimum and 128-character maximum password', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
  });

  it('defaults pagination to page 1, limit 20 and enforces the 1-50 range', () => {
    expect(paginationSchema.safeParse({}).success).toBe(true);
    const parsed = paginationSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);

    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(paginationSchema.safeParse({ limit: 50, page: 10 }).success).toBe(true);
    expect(paginationSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('validates object identifiers as 24 hex characters', () => {
    expect(objectIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
    expect(objectIdSchema.safeParse('not-an-object-id').success).toBe(false);
    expect(objectIdSchema.safeParse('507F1F77BCF86CD799439011').success).toBe(false);
  });

  it('bounds presign uploads to the four allowed media types and 25 MB', () => {
    expect(
      presignSchema.safeParse({ filename: 'a.pdf', declaredMime: 'application/pdf', sizeBytes: 26_214_400 })
        .success,
    ).toBe(true);
    expect(
      presignSchema.safeParse({ filename: 'a.pdf', declaredMime: 'application/pdf', sizeBytes: 26_214_401 })
        .success,
    ).toBe(false);
    expect(
      presignSchema.safeParse({ filename: 'a.exe', declaredMime: 'application/x-msdownload', sizeBytes: 10 })
        .success,
    ).toBe(false);
    expect(
      presignSchema.safeParse({ filename: '../etc/passwd', declaredMime: 'text/plain', sizeBytes: 10 })
        .success,
    ).toBe(false);
  });
});
