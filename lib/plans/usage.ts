import { Material } from '@/lib/db/models/material';
import { Lesson } from '@/lib/db/models/lesson';
import { Quiz } from '@/lib/db/models/quiz';
import { User } from '@/lib/db/models/user';
import { planLimitsFor, PLAN_FAILURE_CODES, type PlanLimits } from './index';
import { allowanceUsage } from './allowance';
import { deleteMaterialCascade } from '@/lib/materials/delete-service';
import { auditEvents } from '@/lib/logging/audit-events';

/**
 * Live (non-deleted) material and lesson counts. Rows in any active status —
 * including awaiting_upload, failed, and quarantined — hold storage and count
 * against the plan quota; deleting reclaims the slot.
 */
export async function countUserMaterials(userId: string): Promise<number> {
  return Material.countDocuments({ userId, deletedAt: null }).exec();
}

export async function countUserLessons(userId: string): Promise<number> {
  return Lesson.countDocuments({ userId, deletedAt: null, status: { $ne: 'deleted' } }).exec();
}

/** Non-deleted quizzes (any status holds the slot until deleted). */
export async function countUserQuizzes(userId: string): Promise<number> {
  return Quiz.countDocuments({ userId, status: { $ne: 'deleted' } }).exec();
}

/** Worker/route helper: resolves a user's plan id and limits (defaults to free). */
export async function userPlanContext(userId: string): Promise<{ plan: string; limits: PlanLimits }> {
  const user = await User.findById(userId).select('plan').lean<{ plan?: string | null }>().exec();
  const plan = user?.plan ?? 'free';
  return { plan, limits: planLimitsFor(plan) };
}

/**
 * Quota-recovery path (constitution v2.3.0): when a follow-up upload is blocked
 * by the material quota, records that failed the per-material character cap are
 * dead weight — they can never be parsed or used as sources. Each one is purged
 * through the same cascade as a user deletion (storage object, assets, job,
 * record) and audited, after the blocking 403 has informed the user.
 */
export async function purgeCharLimitFailures(
  userId: string,
  correlationId: string,
): Promise<number> {
  const doomed = await Material.find({
    userId,
    status: 'failed',
    failureCode: PLAN_FAILURE_CODES.chars,
    deletedAt: null,
  })
    .select('_id')
    .lean<{ _id: { toHexString(): string } }[]>()
    .exec();

  let purged = 0;
  for (const record of doomed) {
    await deleteMaterialCascade(userId, record._id.toHexString());
    await auditEvents.planLimitPurge({
      userId,
      correlationId,
      metadata: { materialId: record._id.toHexString(), reason: PLAN_FAILURE_CODES.chars },
    });
    purged += 1;
  }
  return purged;
}

export interface UsageSnapshot {
  plan: string;
  materials: { used: number; limit: number };
  lessons: { used: number; limit: number };
  maxMaterialChars: number;
  generations: { used: number; limit: number; resetsAt: string | null };
}

/** Combined quota view for /api/me/usage and the list-page badges. */
export async function usageSnapshot(userId: string, plan: string | null): Promise<UsageSnapshot> {
  const limits = planLimitsFor(plan);
  const [materialsUsed, lessonsUsed, generations] = await Promise.all([
    countUserMaterials(userId),
    countUserLessons(userId),
    allowanceUsage(userId),
  ]);
  return {
    plan: plan ?? 'free',
    materials: { used: materialsUsed, limit: limits.materials },
    lessons: { used: lessonsUsed, limit: limits.lessons },
    maxMaterialChars: limits.maxMaterialChars,
    generations: {
      used: generations.used,
      limit: limits.dailyLessonGenerations,
      resetsAt: generations.resetsAt ? generations.resetsAt.toISOString() : null,
    },
  };
}
