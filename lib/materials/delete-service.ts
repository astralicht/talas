import { getLogger } from '@/lib/logging/logger';
import { deleteObject, deleteObjectPrefix } from '@/lib/storage/s3';
import { Material, type IMaterial } from '@/lib/db/models/material';
import { ProcessingJob } from '@/lib/db/models/processing-job';
import { Lesson } from '@/lib/db/models/lesson';
import { LessonRevision } from '@/lib/db/models/lesson-revision';

export interface MaterialDeletionResult {
  materialId: string;
  lessonDeleted: boolean;
  revisionsDeleted: number;
  jobDeleted: boolean;
}

/**
 * Deletes a user's material and everything derived from it: the processing job,
 * the generated lesson, its revision history, and the stored object.
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
  const material = await Material.findOne({ _id: materialId, userId }).lean<IMaterial | null>().exec();

  if (material) {
    try {
      await deleteObject(material.storageKey);
      await deleteObjectPrefix(`${material.storageKey}/`);
    } catch (error) {
      logger.warn({ err: error, materialId }, 'Storage cleanup failed during material deletion');
    }
  }

  const [job, lesson] = await Promise.all([
    ProcessingJob.findOneAndDelete({ userId, materialId }).exec(),
    Lesson.findOneAndDelete({ userId, materialId }).exec(),
  ]);

  const revisions = lesson
    ? await LessonRevision.deleteMany({ userId, lessonId: lesson._id }).exec()
    : null;

  await Material.updateOne(
    { _id: materialId, userId },
    { $set: { status: 'deleted', deletedAt: new Date() } },
  ).exec();

  return {
    materialId,
    lessonDeleted: Boolean(lesson),
    revisionsDeleted: revisions?.deletedCount ?? 0,
    jobDeleted: Boolean(job),
  };
}
