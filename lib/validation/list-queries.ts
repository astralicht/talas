import { z } from 'zod';
import { paginationSchema, strictObject } from './common';
import { MATERIAL_STATUSES, type MaterialStatus } from '@/lib/db/models/material';

/**
 * Shared list-query validation for the materials/lessons list endpoints
 * (GET /api/materials, GET /api/lessons) and the matching pages. Pages parse
 * the same schemas from URL search params so URLs are shareable state.
 */

const searchSchema = z.string().trim().max(100, 'Search is limited to 100 characters');

// ---------------------------------------------------------------- materials

export const materialStatusGroups = [
  'all',
  'awaiting_upload',
  'uploaded',
  'processing',
  'ready',
  'failed',
  'quarantined',
] as const;
export type MaterialStatusGroup = (typeof materialStatusGroups)[number];

/**
 * UI-friendly status groups; 'processing' bundles the in-flight statuses.
 * There is deliberately no 'deleted' group: soft-deleted materials are never
 * listable — the default 'all' group resolves to every live status (the
 * lessons list behaves the same, and `status=deleted` is rejected with 400).
 */
const MATERIAL_STATUS_GROUP_MAP: Record<
  Exclude<MaterialStatusGroup, 'all'>,
  readonly MaterialStatus[]
> = {
  awaiting_upload: ['awaiting_upload'],
  uploaded: ['uploaded'],
  processing: ['scanning', 'queued', 'processing'],
  ready: ['ready'],
  failed: ['failed'],
  quarantined: ['quarantined'],
};

const LIVE_MATERIAL_STATUSES: readonly MaterialStatus[] = MATERIAL_STATUSES.filter(
  (status) => status !== 'deleted',
);

export function materialStatusesFor(group: MaterialStatusGroup): MaterialStatus[] {
  return group === 'all' ? [...LIVE_MATERIAL_STATUSES] : [...MATERIAL_STATUS_GROUP_MAP[group]];
}

export const materialSorts = ['newest', 'oldest', 'name', 'largest'] as const;
export type MaterialSort = (typeof materialSorts)[number];

export const MATERIAL_SORT_FIELDS: Record<MaterialSort, { field: string; direction: 1 | -1 }> = {
  newest: { field: 'createdAt', direction: -1 },
  oldest: { field: 'createdAt', direction: 1 },
  name: { field: 'originalFilename', direction: 1 },
  largest: { field: 'sizeBytes', direction: -1 },
};

export const materialListQuerySchema = strictObject({
  ...paginationSchema.shape,
  q: searchSchema.optional(),
  status: z.enum(materialStatusGroups).default('all'),
  sort: z.enum(materialSorts).default('newest'),
});

export type MaterialListQuery = z.infer<typeof materialListQuerySchema>;

/** Repository-facing params; status/sort are optional so callers can rely on defaults. */
export interface MaterialListParams {
  page: number;
  limit: number;
  q?: string;
  status?: MaterialStatusGroup;
  sort?: MaterialSort;
}

// ---------------------------------------------------------------- lessons

export const lessonStatusFilters = ['all', 'ready', 'draft'] as const;
export type LessonStatusFilter = (typeof lessonStatusFilters)[number];

export const lessonSorts = ['recent', 'oldest', 'title'] as const;
export type LessonSort = (typeof lessonSorts)[number];

export const LESSON_SORT_FIELDS: Record<LessonSort, { field: string; direction: 1 | -1 }> = {
  recent: { field: 'updatedAt', direction: -1 },
  oldest: { field: 'updatedAt', direction: 1 },
  title: { field: 'title', direction: 1 },
};

export const lessonListQuerySchema = strictObject({
  ...paginationSchema.shape,
  q: searchSchema.optional(),
  status: z.enum(lessonStatusFilters).default('all'),
  sort: z.enum(lessonSorts).default('recent'),
});

export type LessonListQuery = z.infer<typeof lessonListQuerySchema>;

/** Repository-facing params; status/sort are optional so callers can rely on defaults. */
export interface LessonListParams {
  page: number;
  limit: number;
  q?: string;
  status?: LessonStatusFilter;
  sort?: LessonSort;
}

// ---------------------------------------------------------------- helpers

/**
 * Builds a shareable URL for a list page, omitting default values so URLs
 * stay clean (used by the pagination links on the server-rendered pages).
 */
export function buildListHref(
  basePath: string,
  query: { q?: string; status?: string; sort?: string },
  options: { defaultStatus: string; defaultSort: string; page?: number },
): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status && query.status !== options.defaultStatus) params.set('status', query.status);
  if (query.sort && query.sort !== options.defaultSort) params.set('sort', query.sort);
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}
