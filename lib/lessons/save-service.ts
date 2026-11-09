import { Types, type ClientSession } from 'mongoose';
import { Lesson, MAX_LESSON_CONTENT_LENGTH, type ILesson } from '@/lib/db/models/lesson';
import { LessonRevision, type ILessonRevision } from '@/lib/db/models/lesson-revision';
import { sanitizeLessonContent } from '@/lib/security/sanitize';
import { withTransaction } from '@/lib/db/connection';
import { errors } from '@/lib/http/errors';

export interface SaveLessonInput {
  version: number;
  title: string;
  contentMarkdown: string;
  authorType: 'user' | 'system';
}

export interface SaveLessonResult {
  lesson: ILesson;
  revision: ILessonRevision;
}

function asObjectId(value: string | Types.ObjectId): Types.ObjectId {
  return typeof value === 'string' ? new Types.ObjectId(value) : value;
}

/**
 * Saves lesson edits with optimistic concurrency and an append-only revision in
 * the same MongoDB transaction.
 *
 * The version acts as a compare-and-swap token: `findOneAndUpdate` bumps the
 * version atomically, and a mismatch (another tab saved first, or the lesson was
 * deleted) results in a no-write conflict instead of a lost update. Sanitization
 * happens before persistence so unsafe content is never stored.
 */
export async function saveLesson(
  userId: string,
  lessonId: string,
  input: SaveLessonInput,
): Promise<SaveLessonResult> {
  if (input.contentMarkdown.length > MAX_LESSON_CONTENT_LENGTH) {
    throw errors.validation(
      [{ path: 'contentMarkdown', message: 'Lesson content is larger than the 1 MB limit.' }],
    );
  }

  const contentMarkdown = sanitizeLessonContent(input.contentMarkdown).trim();
  const title = input.title.trim();
  if (title.length === 0) {
    throw errors.validation([{ path: 'title', message: 'The title cannot be empty.' }]);
  }

  const filter = {
    _id: asObjectId(lessonId),
    userId: asObjectId(userId),
    version: input.version,
  };

  return withTransaction(async (session: ClientSession) => {
    const lesson = await Lesson.findOneAndUpdate(
      filter,
      {
        $set: { title, contentMarkdown, status: 'ready' },
        $inc: { version: 1 },
      },
      { new: true, session },
    ).exec();

    if (!lesson) {
      const existing = await Lesson.findOne({ _id: filter._id, userId: filter.userId })
        .session(session)
        .exec();
      if (!existing) throw errors.notFound();
      throw errors.conflict('This lesson changed while you were editing. Reload to continue.');
    }

    const [revision] = await LessonRevision.create(
      [
        {
          userId: filter.userId,
          lessonId: lesson._id,
          version: lesson.version,
          title: lesson.title,
          contentMarkdown: lesson.contentMarkdown,
          authorType: input.authorType,
        },
      ],
      { session },
    );
    if (!revision) throw new Error('Revision could not be appended');

    return { lesson, revision };
  });
}
