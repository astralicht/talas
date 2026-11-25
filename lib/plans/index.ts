/**
 * Plan-based feature limits (constitution v2.3.0, Principle IV). The `PLANS`
 * record is the single source of truth: adding a higher tier is a new entry
 * plus an enum value — enforcement code reads limits through `planLimitsFor`
 * and never branches on specific plan ids.
 */
export const PLAN_IDS = ['free', 'plus'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const DEFAULT_PLAN: PlanId = 'free';

export interface PlanLimits {
  /** Maximum non-deleted materials stored at once. */
  materials: number;
  /** Maximum extracted-text characters per material. */
  maxMaterialChars: number;
  /** Maximum non-deleted lessons stored at once. */
  lessons: number;
  /**
   * Daily lesson-generation allowance. Derives from the tier's lesson storage
   * quota by default; override explicitly for a tier that should be capped
   * differently. Regeneration does not consume the allowance.
   */
  dailyLessonGenerations: number;
  /** Maximum non-deleted quizzes stored at once (TODO step 14). */
  quizzes: number;
  /** Maximum lessons a single quiz generation may draw from (TODO step 14). */
  maxQuizSources: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    materials: 5,
    lessons: 3,
    maxMaterialChars: 10_000,
    dailyLessonGenerations: 3,
    quizzes: 3,
    maxQuizSources: 3,
  },
  plus: {
    materials: 25,
    lessons: 7,
    maxMaterialChars: 10_000,
    dailyLessonGenerations: 7,
    quizzes: 5,
    maxQuizSources: 7,
  },
};

/** Machine-readable failure codes surfaced through the 403 quota envelope. */
export const PLAN_FAILURE_CODES = {
  materials: 'plan_material_limit',
  chars: 'plan_char_limit',
  lessons: 'plan_lesson_limit',
  generations: 'plan_generation_limit',
  quizzes: 'plan_quiz_limit',
  quizSources: 'plan_quiz_sources',
} as const;

/**
 * Resolves the limits for a user's stored plan value. Unknown or missing
 * values fall back to the default plan so a fresh user is always limited.
 */
export function planLimitsFor(plan: string | null | undefined): PlanLimits {
  if (plan && (PLAN_IDS as readonly string[]).includes(plan)) {
    return PLANS[plan as PlanId];
  }
  return PLANS[DEFAULT_PLAN];
}
