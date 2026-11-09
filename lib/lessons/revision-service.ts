import { Types } from 'mongoose';
import { Lesson, type ILesson } from '@/lib/db/models/lesson';
import { LessonRevision, type ILessonRevision } from '@/lib/db/models/lesson-revision';
import { sanitizeLessonContent } from '@/lib/security/sanitize';
import { withTransaction } from '@/lib/db/connection';
import { errors } from '@/lib/http/errors';

function ensureObjectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw errors.notFound();
  return new Types.ObjectId(value);
}

/** Revision summaries, newest first, tenant-scoped to the session user. */
export async function listRevisions(
  userId: string,
  lessonId: string,
): Promise<ILessonRevision[]> {
  const lessonObjectId = ensureObjectId(lessonId);
  const [lesson] = await Promise.all([
    Lesson.findOne({ _id: lessonObjectId, userId: new Types.ObjectId(userId) }).lean<ILesson | null>().exec(),
  ]);
  if (!lesson) throw errors.notFound();

  return LessonRevision.find({
    userId: new Types.ObjectId(userId),
    lessonId: lessonObjectId,
  })
    .sort({ version: -1 })
    .exec();
}

export interface RestoreResult {
  lesson: ILesson;
  revision: ILessonRevision;
}

/**
 * Restores a revision as a NEW version. History is never rewritten: the previous
 * versions stay untouched and the restored content becomes the newest revision.
 */
export async function restoreRevision(
  userId: string,
  lessonId: string,
  revisionId: string,
  revisionVersion: number,
): Promise<RestoreResult> {
  const lessonObjectId = ensureObjectId(lessonId);
  const revisionObjectId = ensureObjectId(revisionId);
  const userObjectId = new Types.ObjectId(userId);

  return withTransaction(async (session) => {
    const revision = await LessonRevision.findOne({
      _id: revisionObjectId,
      lessonId: lessonObjectId,
      userId: userObjectId,
      version: revisionVersion,
    })
      .session(session)
      .exec();
    if (!revision) throw errors.notFound();

    const lesson = await Lesson.findOne({
      _id: lessonObjectId,
      userId: userObjectId,
    })
      .session(session)
      .exec();
    if (!lesson) throw errors.notFound();

    if (lesson.version === revision.version) {
      throw errors.conflict('This revision is already the current version. Reload to continue.');
    }

    const contentMarkdown = sanitizeLessonContent(revision.contentMarkdown).trim();
    const title = revision.title.trim();

    const updated = await Lesson.findOneAndUpdate(
      { _id: lessonObjectId, userId: userObjectId },
      { $set: { title, contentMarkdown, status: 'ready' }, $inc: { version: 1 } },
      { new: true, session },
    ).exec();
    if (!updated) throw errors.conflict('This lesson changed while you were editing. Reload to continue.');

    const [appended] = await LessonRevision.create(
      [
        {
          userId: userObjectId,
          lessonId: updated._id,
          version: updated.version,
          title: updated.title,
          contentMarkdown: updated.contentMarkdown,
          authorType: 'user',
        },
      ],
      { session },
    );
    if (!appended) throw new Error('Revision could not be appended');

    return { lesson: updated, revision: appended };
  });
}
