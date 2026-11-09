import { Types } from 'mongoose';
import { LessonRevision, type ILessonRevision } from '@/lib/db/models/lesson-revision';
import { TenantRepository } from '@/lib/db/repositories/tenant-repository';

export class LessonRevisionRepository extends TenantRepository<ILessonRevision> {
  constructor(userId: string | Types.ObjectId) {
    super(LessonRevision, userId);
  }  async listForLesson(lessonId: string | Types.ObjectId, options: { limit?: number } = {}) {
    const query = this.model
      .find({ userId: this.tenantId, lessonId: new Types.ObjectId(lessonId) })
      .sort({ version: -1 });
    if (options.limit !== undefined) query.limit(options.limit);
    return query.exec();
  }

  async findByVersion(lessonId: string | Types.ObjectId, version: number) {
    return this.model
      .findOne({
        userId: this.tenantId,
        lessonId: new Types.ObjectId(lessonId),
        version,
      })
      .exec();
  }

  async findOwnedRevision(lessonId: string | Types.ObjectId, revisionId: string | Types.ObjectId) {
    return this.model
      .findOne({
        userId: this.tenantId,
        lessonId: new Types.ObjectId(lessonId),
        _id: new Types.ObjectId(revisionId),
      })
      .exec();
  }

  async append(input: {
    lessonId: string | Types.ObjectId;
    version: number;
    title: string;
    contentMarkdown: string;
    authorType: 'system' | 'user';
    session?: unknown;
  }) {
    const [revision] = await LessonRevision.create(
      [
        {
          userId: this.tenantId,
          lessonId: new Types.ObjectId(input.lessonId),
          version: input.version,
          title: input.title,
          contentMarkdown: input.contentMarkdown,
          authorType: input.authorType,
        },
      ],
      input.session ? { session: input.session as never } : undefined,
    );
    if (!revision) throw new Error('Lesson revision could not be created');
    return revision;
  }
}
