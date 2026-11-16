import { Types, type FilterQuery } from 'mongoose';
import { Lesson, type ILesson } from '@/lib/db/models/lesson';
import { TenantRepository } from './tenant-repository';
import { escapeRegex, paginationToSkip } from '@/lib/validation/common';
import { LESSON_SORT_FIELDS, type LessonListParams } from '@/lib/validation/list-queries';

export class LessonRepository extends TenantRepository<ILesson> {
  constructor(userId: string | Types.ObjectId) {
    super(Lesson, userId);
  }

  /**
   * Paged, filtered, and sorted listing (search + status filter + sort are
   * shared with the API route and the lessons page through the same query
   * schema). Search matches title and summary; deleted lessons stay excluded.
   */
  async listPaged(params: LessonListParams) {
    const statusFilter = params.status ?? 'all';
    const sortKey = params.sort ?? 'recent';
    const filter = {
      status: statusFilter === 'all' ? { $ne: 'deleted' } : statusFilter,
      ...(params.q
        ? {
            $or: [
              { title: { $regex: escapeRegex(params.q), $options: 'i' } },
              { summary: { $regex: escapeRegex(params.q), $options: 'i' } },
            ],
          }
        : {}),
    } as FilterQuery<ILesson>;
    const sortField = LESSON_SORT_FIELDS[sortKey];
    const [data, total] = await Promise.all([
      this.list(filter, {
        skip: paginationToSkip(params),
        limit: params.limit,
        sort: { [sortField.field]: sortField.direction },
        collation: sortKey === 'title' ? { locale: 'en', strength: 2 } : undefined,
      }),
      this.count(filter),
    ]);
    return { data, total };
  }

  async findOwnedById(id: string) {
    return this.findOne({ _id: id, status: { $ne: 'deleted' } });
  }

  async findByMaterialId(materialId: string | Types.ObjectId) {
    return this.model
      .findOne({ userId: this.tenantId, materialId: new Types.ObjectId(materialId) })
      .exec();
  }

  /** Any non-deleted lesson that lists the material among its sources (specs/005). */
  async findBySourceMaterial(materialId: string | Types.ObjectId) {
    return this.model
      .findOne({
        userId: this.tenantId,
        sourceMaterialIds: new Types.ObjectId(materialId),
        status: { $ne: 'deleted' },
      })
      .exec();
  }
}
