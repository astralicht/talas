import { describe, expect, it } from 'vitest';
import {
  buildListHref,
  lessonListQuerySchema,
  materialListQuerySchema,
  materialStatusesFor,
} from '@/lib/validation/list-queries';

describe('material list query schema', () => {
  it('applies defaults for omitted filters', () => {
    const parsed = materialListQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, limit: 20, status: 'all', sort: 'newest' });
  });

  it('coerces and trims provided values', () => {
    const parsed = materialListQuerySchema.parse({
      page: '2',
      limit: '10',
      q: '  report ',
      status: 'ready',
      sort: 'name',
    });
    expect(parsed).toEqual({ page: 2, limit: 10, q: 'report', status: 'ready', sort: 'name' });
  });

  it('rejects unknown sorts, statuses, oversized searches, and extra keys', () => {
    expect(materialListQuerySchema.safeParse({ sort: 'shiniest' }).success).toBe(false);
    expect(materialListQuerySchema.safeParse({ status: 'ready?' }).success).toBe(false);
    expect(materialListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(materialListQuerySchema.safeParse({ extra: '1' }).success).toBe(false);
  });

  it('rejects out-of-range pagination', () => {
    expect(materialListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(materialListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });

  it('maps the processing group to its concrete statuses', () => {
    expect(materialStatusesFor('processing').sort()).toEqual(['processing', 'queued', 'scanning']);
    // 'all' is the live set: soft-deleted rows are never listable.
    expect(materialStatusesFor('all')).toEqual([
      'awaiting_upload',
      'uploaded',
      'scanning',
      'queued',
      'processing',
      'ready',
      'failed',
      'quarantined',
    ]);
    expect(materialStatusesFor('all')).not.toContain('deleted');
    expect(materialStatusesFor('ready')).toEqual(['ready']);
  });

  it('rejects the deleted status filter like the lessons list', () => {
    expect(materialListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});

describe('lesson list query schema', () => {
  it('applies defaults for omitted filters', () => {
    const parsed = lessonListQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, limit: 20, status: 'all', sort: 'recent' });
  });

  it('rejects foreign sorts and the deleted status filter', () => {
    expect(lessonListQuerySchema.safeParse({ sort: 'largest' }).success).toBe(false);
    expect(lessonListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(lessonListQuerySchema.safeParse({ status: 'draft', sort: 'title' }).success).toBe(true);
  });
});

describe('buildListHref', () => {
  it('omits default filters and page 1', () => {
    expect(
      buildListHref(
        '/materials',
        { q: '', status: 'all', sort: 'newest' },
        { defaultStatus: 'all', defaultSort: 'newest' },
      ),
    ).toBe('/materials');
  });

  it('encodes active filters and the page number', () => {
    expect(
      buildListHref(
        '/lessons',
        { q: 'quiz', status: 'all', sort: 'title' },
        { defaultStatus: 'all', defaultSort: 'recent', page: 3 },
      ),
    ).toBe('/lessons?q=quiz&sort=title&page=3');
  });
});
