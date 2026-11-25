import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { planLimitsFor } from '@/lib/plans';
import { countUserMaterials } from '@/lib/plans/usage';
import { MaterialList } from '@/components/materials/material-list';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { buttonVariants } from '@/components/ui/button';
import {
  buildListHref,
  materialListQuerySchema,
  type MaterialListQuery,
} from '@/lib/validation/list-queries';

export const metadata: Metadata = { title: 'Materials' };
export const dynamic = 'force-dynamic';

type RawSearchParams = Record<string, string | string[] | undefined>;

function normalizeSearchParams(params: RawSearchParams): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') normalized[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') normalized[key] = value[0];
  }
  return normalized;
}

const MATERIAL_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'awaiting_upload', label: 'Awaiting upload' },
  { value: 'uploaded', label: 'Uploaded' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'failed', label: 'Failed' },
  { value: 'quarantined', label: 'Quarantined' },
];

const MATERIAL_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'largest', label: 'Largest first' },
];

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Invalid or hostile params fall back to defaults instead of erroring the page.
  const parsed = materialListQuerySchema.safeParse(normalizeSearchParams(await searchParams));
  const query: MaterialListQuery = parsed.success ? parsed.data : materialListQuerySchema.parse({});

  const repository = new MaterialRepository(user.id);
  const { data: initialData, total } = await repository.listPaged(query);

  // Server-rendered plan quota (constitution v2.3.0): the badge counts the
  // same live rows the enforcement checks count.
  const limits = planLimitsFor(user.plan);
  const materialsUsed = await countUserMaterials(user.id);

  const pages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, pages);
  let data = initialData;
  if (total > 0 && page !== query.page) {
    ({ data } = await repository.listPaged({ ...query, page }));
  }

  const start = total === 0 ? 0 : (page - 1) * query.limit + 1;
  const end = Math.min(page * query.limit, total);
  const hasFilters = Boolean(query.q) || query.status !== 'all' || query.sort !== 'newest';
  const href = (nextPage: number) =>
    buildListHref('/materials', query, {
      defaultStatus: 'all',
      defaultSort: 'newest',
      page: nextPage,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Materials</h1>
          <p className="text-muted-foreground mt-1 text-sm">Documents only you can see.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            data-testid="materials-quota"
            className={`border-border bg-card text-muted-foreground rounded-full border px-3 py-1.5 text-xs font-medium ${
              materialsUsed >= limits.materials ? 'text-amber-700 dark:text-amber-300' : ''
            }`}
          >
            {materialsUsed}/{limits.materials} materials · {user.plan} plan
          </span>
          {user.emailVerified ? (
            <Link
              href="/materials/new"
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              Upload material
            </Link>
          ) : null}
        </div>
      </div>

      <ListToolbar
        action="/materials"
        search={{
          name: 'q',
          value: query.q ?? '',
          label: 'Search',
          placeholder: 'Search filenames…',
          testid: 'materials-search',
        }}
        status={{
          name: 'status',
          value: query.status,
          defaultValue: 'all',
          label: 'Status',
          options: MATERIAL_STATUS_OPTIONS,
          testid: 'materials-status',
        }}
        sort={{
          name: 'sort',
          value: query.sort,
          defaultValue: 'newest',
          label: 'Sort',
          options: MATERIAL_SORT_OPTIONS,
          testid: 'materials-sort',
        }}
        hasFilters={hasFilters}
      />

      {data.length === 0 ? (
        <div className="border-border bg-card rounded-2xl border p-8 text-center">
          {hasFilters ? (
            <p className="text-foreground font-medium">No materials match your filters.</p>
          ) : (
            <p className="text-foreground font-medium">No materials yet</p>
          )}
          <p className="text-muted-foreground mt-1 text-sm">
            {user.emailVerified
              ? 'Upload a PDF, DOCX, Markdown, or text document to get started.'
              : 'Verify your email to upload materials.'}
          </p>
          {hasFilters ? (
            <Link href="/materials" data-testid="materials-clear-empty" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4`}>
              Clear filters
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="border-border bg-card rounded-2xl border">
            <MaterialList materials={data} />
            <div className="border-border text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm sm:px-5">
              <span data-testid="materials-count">
                Showing {start}–{end} of {total}
              </span>
              {pages > 1 ? (
                <span className="flex items-center gap-3">
                  {page > 1 ? (
                    <Link href={href(page - 1)} className="hover:text-foreground">
                      ← Newer
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span>
                    Page {page}
                    {page < pages ? (
                      <Link href={href(page + 1)} className="text-brand-700 ml-3 hover:underline">
                        Older →
                      </Link>
                    ) : null}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
