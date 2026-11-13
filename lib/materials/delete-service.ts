import { getLogger } from '@/lib/logging/logger';
import { Types } from 'mongoose';
import { deleteObject, deleteObjectPrefix } from '@/lib/storage/s3';
import { Material, type IMaterial } from '@/lib/db/models/material';
import { ProcessingJob } from '@/lib/db/models/processing-job';
import { Lesson, type ILesson } from '@/lib/db/models/lesson';
import { LessonRevision } from '@/lib/db/models/lesson-revision';

export interface MaterialDeletionResult {
  materialId: string;
  /** Lessons that lost the material from their source list but survive. */
  lessonsUpdated: number;
  /** Lessons whose only source was this material; they are removed. */
  lessonsDeleted: number;
  revisionsDeleted: number;
  jobDeleted: boolean;
}

/**
 * Deletes a user's material and its derived processing artifacts (the
 * processing job and the stored object). Lessons are decoupled (specs/005):
 * the material is pulled from every lesson's `sourceMaterialIds`, lessons that
 * keep other sources survive (with the next source promoted to the primary
 * `materialId`), and only lessons that lose their last source are removed —
 * along with their revision history.
 *
 * All queries include the explicit `userId` so the cascade stays tenant-scoped even
 * when it runs in the worker, outside the session guard. The material row is kept
 * with `status: 'deleted'`; tenant queries exclude deleted rows, so reads return
 * the same non-revealing 404 as a missing row.
 */
export async function deleteMaterialCascade(
  userId: string,
  materialId: string,
): Promise<MaterialDeletionResult> {
  const logger = getLogger();
  const materialObjectId = new Types.ObjectId(materialId);

  const material = await Material.findOne({ _id: materialObjectId, userId }).lean<IMaterial | null>().exec();

  if (material) {
    try {
      await deleteObject(material.storageKey);
      await deleteObjectPrefix(`${material.storageKey}/`);
    } catch (error) {
      logger.warn({ err: error, materialId }, 'Storage cleanup failed during material deletion');
    }
  }

  const job = await ProcessingJob.findOneAndDelete({ userId, materialId }).exec();

  // Lessons still referencing the material: pull it from the source list.
  const affected = await Lesson.find({
    userId: new Types.ObjectId(userId),
    sourceMaterialIds: materialObjectId,
  })
    .lean<ILesson[]>()
    .exec();

  let lessonsUpdated = 0;
  let lessonsDeleted = 0;
  let revisionsDeleted = 0;

  for (const lesson of affected) {
    const remaining = (lesson.sourceMaterialIds ?? []).filter(
      (id) => !id.equals(materialObjectId),
    );

    if (remaining.length === 0) {
      await Lesson.deleteOne({ _id: lesson._id, userId }).exec();
      const revisions = await LessonRevision.deleteMany({ userId, lessonId: lesson._id }).exec();
      lessonsDeleted += 1;
      revisionsDeleted += revisions.deletedCount ?? 0;
      continue;
    }

    // Keep the "materialId is the primary/first source" invariant: if the
    // deleted material was the primary, promote the next surviving source.
    const nextPrimary = lesson.materialId.equals(materialObjectId)
      ? remaining[0]
      : lesson.materialId;
    await Lesson.updateOne(
      { _id: lesson._id, userId },
      { $set: { sourceMaterialIds: remaining, materialId: nextPrimary } },
    ).exec();
    lessonsUpdated += 1;
  }

  await Material.updateOne(
    { _id: materialObjectId, userId },
    { $set: { status: 'deleted', deletedAt: new Date() } },
  ).exec();

  return {
    materialId,
    lessonsUpdated,
    lessonsDeleted,
    revisionsDeleted,
    jobDeleted: Boolean(job),
  };
}
