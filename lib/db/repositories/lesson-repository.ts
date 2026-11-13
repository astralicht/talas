import { Types } from 'mongoose';
import { Lesson, type ILesson } from '@/lib/db/models/lesson';
import { TenantRepository } from './tenant-repository';
import type { Pagination } from '@/lib/validation/common';
import { paginationToSkip } from '@/lib/validation/common';

export class LessonRepository extends TenantRepository<ILesson> {
  constructor(userId: string | Types.ObjectId) {
    super(Lesson, userId);
  }

  async listPaged(pagination: Pagination) {
    const [data, total] = await Promise.all([
      this.list({ status: { $ne: 'deleted' } }, {
        skip: paginationToSkip(pagination),
        limit: pagination.limit,
        sort: { updatedAt: -1 },
      }),
      this.count({ status: { $ne: 'deleted' } }),
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
