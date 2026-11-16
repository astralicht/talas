import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { MaterialRepository } from '@/lib/db/repositories/material-repository';
import { MaterialList } from '@/components/materials/material-list';
import { ListToolbar } from '@/components/ui/list-toolbar';
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
  { value: 'deleted', label: 'Deleted' },
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold">Materials</h1>
          <p className="text-muted-foreground text-sm">Documents only you can see.</p>
        </div>
        {user.emailVerified ? (
          <Link
            href="/materials/new"
            className="bg-brand-600 hover:bg-brand-700 rounded-md px-4 py-2 text-sm font-medium text-white"
          >
            Upload material
          </Link>
        ) : null}
      </div>

      <section className="border-border bg-card space-y-4 rounded-xl border p-6">
        <ListToolbar
          action="/materials"
          search={{
            name: 'q',
            value: query.q ?? '',
            label: 'Search',
            placeholder: 'Search filenames',
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
          hasFilters ? (
            <p className="text-muted-foreground text-sm">
              No materials match your search or filters.{' '}
              <Link
                href="/materials"
                data-testid="materials-clear-empty"
                className="text-brand-600 font-medium hover:underline"
              >
                Clear filters
              </Link>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              No materials yet.{' '}
              {user.emailVerified ? (
                <Link href="/materials/new" className="text-brand-600 font-medium hover:underline">
                  Upload your first document.
                </Link>
              ) : (
                'Verify your email to upload materials.'
              )}
            </p>
          )
        ) : (
          <>
            <MaterialList materials={data} />
            <div className="border-border text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
              <span data-testid="materials-count">
                Showing {start}–{end} of {total}
              </span>
              {pages > 1 ? (
                <span className="flex items-center gap-3">
                  {page > 1 ? (
                    <Link
                      href={href(page - 1)}
                      className="text-brand-600 font-medium hover:underline"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span>Previous</span>
                  )}
                  <span>
                    Page {page} of {pages}
                  </span>
                  {page < pages ? (
                    <Link
                      href={href(page + 1)}
                      className="text-brand-600 font-medium hover:underline"
                    >
                      Next
                    </Link>
                  ) : (
                    <span>Next</span>
                  )}
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
