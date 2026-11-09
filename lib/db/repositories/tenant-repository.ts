import {
  Types,
  type FilterQuery,
  type Model,
  type QueryOptions,
  type UpdateQuery,
} from 'mongoose';

/**
 * Base repository for tenant-scoped collections.
 *
 * The session-derived `userId` is supplied once in the constructor and injected into
 * every filter. Public methods intentionally accept no owner identifier, so callers
 * cannot widen a query beyond the authenticated tenant.
 */
export class TenantRepository<T extends { userId: Types.ObjectId }> {
  protected readonly userId: Types.ObjectId;

  constructor(
    protected readonly model: Model<T>,
    userId: string | Types.ObjectId,
  ) {
    this.userId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  }

  protected scope(filter: FilterQuery<T> = {}): FilterQuery<T> {
    return { ...filter, userId: this.userId } as FilterQuery<T>;
  }

  async findById(id: string | Types.ObjectId) {
    return this.model.findOne(this.scope({ _id: id } as FilterQuery<T>)).exec();
  }

  async findOne(filter: FilterQuery<T> = {}) {
    return this.model.findOne(this.scope(filter)).exec();
  }

  async list(
    filter: FilterQuery<T> = {},
    options: { skip?: number; limit?: number; sort?: Record<string, 1 | -1> } = {},
  ) {
    const query = this.model
      .find(this.scope(filter))
      .sort(options.sort ?? { createdAt: -1 })
      .skip(options.skip ?? 0);
    if (options.limit !== undefined) query.limit(options.limit);
    return query.exec();
  }

  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(this.scope(filter)).exec();
  }

  async updateById(
    id: string | Types.ObjectId,
    update: UpdateQuery<T>,
    options: QueryOptions<T> = {},
  ) {
    return this.model
      .findOneAndUpdate(this.scope({ _id: id } as FilterQuery<T>), update, {
        new: true,
        ...options,
      })
      .exec();
  }

  async deleteById(id: string | Types.ObjectId) {
    return this.model.findOneAndDelete(this.scope({ _id: id } as FilterQuery<T>)).exec();
  }

  async deleteMany(filter: FilterQuery<T> = {}): Promise<number> {
    const result = await this.model.deleteMany(this.scope(filter)).exec();
    return result.deletedCount ?? 0;
  }

  async exists(filter: FilterQuery<T> = {}): Promise<boolean> {
    const result = await this.model.exists(this.scope(filter));
    return result !== null;
  }

  get tenantId(): Types.ObjectId {
    return this.userId;
  }
}
