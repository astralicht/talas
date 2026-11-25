import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { LessonRepository } from '@/lib/db/repositories/lesson-repository';
import { planLimitsFor } from '@/lib/plans';
import { usageSnapshot } from '@/lib/plans/usage';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { buttonVariants } from '@/components/ui/button';
import { serializeLessonSummary } from '@/lib/http/serializers';
import {
  buildListHref,
  lessonListQuerySchema,
  type LessonListQuery,
} from '@/lib/validation/list-queries';

export const metadata: Metadata = { title: 'Lessons' };
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

const LESSON_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'ready', label: 'Ready' },
  { value: 'draft', label: 'Draft' },
];

const LESSON_SORT_OPTIONS = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
];

export default async function LessonsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Invalid or hostile params fall back to defaults instead of erroring the page.
  const parsed = lessonListQuerySchema.safeParse(normalizeSearchParams(await searchParams));
  const query: LessonListQuery = parsed.success ? parsed.data : lessonListQuerySchema.parse({});

  const repository = new LessonRepository(user.id);
  const { data: initialData, total } = await repository.listPaged(query);

  // Server-rendered plan quota (constitution v2.3.0): storage slots and the
  // daily generation allowance, matching what the routes enforce.
  const limits = planLimitsFor(user.plan);
  const usage = await usageSnapshot(user.id, user.plan);

  const pages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, pages);
  let data = initialData;
  if (total > 0 && page !== query.page) {
    ({ data } = await repository.listPaged({ ...query, page }));
  }

  const start = total === 0 ? 0 : (page - 1) * query.limit + 1;
  const end = Math.min(page * query.limit, total);
  const hasFilters = Boolean(query.q) || query.status !== 'all' || query.sort !== 'recent';
  const href = (nextPage: number) =>
    buildListHref('/lessons', query, {
      defaultStatus: 'all',
      defaultSort: 'recent',
      page: nextPage,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground text-2xl font-extrabold tracking-tight">Lessons</h1>
          <p className="text-muted-foreground mt-1 text-sm">Generated and edited study lessons.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            data-testid="lessons-generation-quota"
            className="border-border bg-card text-muted-foreground rounded-full border px-3 py-1.5 text-xs font-medium"
          >
            {usage.generations.used}/{usage.generations.limit} generations today
            {usage.generations.resetsAt
              ? ` · resets ${new Date(usage.generations.resetsAt).toISOString().slice(11, 16)} UTC`
              : ''}
          </span>
          <span
            data-testid="lessons-quota"
            className={`border-border bg-card text-muted-foreground rounded-full border px-3 py-1.5 text-xs font-medium ${
              usage.lessons.used >= limits.lessons ? 'text-amber-700 dark:text-amber-300' : ''
            }`}
          >
            {usage.lessons.used}/{limits.lessons} lessons · {usage.plan} plan
          </span>
          <Link href="/lessons/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            New lesson
          </Link>
        </div>
      </div>

        <ListToolbar
          action="/lessons"
          search={{
            name: 'q',
            value: query.q ?? '',
            label: 'Search',
            placeholder: 'Search titles and summaries',
            testid: 'lessons-search',
          }}
          status={{
            name: 'status',
            value: query.status,
            defaultValue: 'all',
            label: 'Status',
            options: LESSON_STATUS_OPTIONS,
            testid: 'lessons-status',
          }}
          sort={{
            name: 'sort',
            value: query.sort,
            defaultValue: 'recent',
            label: 'Sort',
            options: LESSON_SORT_OPTIONS,
            testid: 'lessons-sort',
          }}
          hasFilters={hasFilters}
        />

      {data.length === 0 ? (
        <div className="border-border bg-card rounded-2xl border p-8 text-center">
          <p className="text-foreground font-medium">
            {hasFilters ? 'No lessons match your filters.' : 'No lessons yet'}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Create one from your processed materials.
          </p>
          {hasFilters ? (
            <Link href="/lessons" data-testid="lessons-clear-empty" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4`}>
              Clear filters
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="border-border bg-card rounded-2xl border">
          <ul className="divide-border divide-y">
            {data.map((lessonDoc) => {
              const lesson = serializeLessonSummary(lessonDoc);
              return (
                <li
                  key={lesson.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl sm:px-5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/lessons/${lesson.id}`}
                      data-testid="lesson-link"
                      className="text-foreground block truncate font-semibold hover:underline"
                    >
                      {lesson.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      Version {lesson.version} · updated{' '}
                      {new Date(lesson.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-border text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm sm:px-5">
            <span data-testid="lessons-count">
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
      )}
    </div>
  );
}
