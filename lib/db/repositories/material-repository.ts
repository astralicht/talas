import { Types, type FilterQuery } from 'mongoose';
import { Material, type IMaterial, type MaterialStatus } from '@/lib/db/models/material';
import { TenantRepository } from './tenant-repository';
import { escapeRegex, paginationToSkip } from '@/lib/validation/common';
import {
  MATERIAL_SORT_FIELDS,
  materialStatusesFor,
  type MaterialListParams,
} from '@/lib/validation/list-queries';

export interface CreateMaterialInput {
  originalFilename: string;
  storageKey: string;
  declaredMime: string;
  sizeBytes: number;
  uploadExpiresAt: Date;
}

/** Builds the server-owned storage key that ties an object to a tenant and material. */
export function storageKeyFor(
  userId: string | Types.ObjectId,
  materialId: string | Types.ObjectId,
): string {
  const owner = typeof userId === 'string' ? userId : userId.toHexString();
  const material = typeof materialId === 'string' ? materialId : materialId.toHexString();
  return `materials/${owner}/${material}`;
}

export class MaterialRepository extends TenantRepository<IMaterial> {
  constructor(userId: string | Types.ObjectId) {
    super(Material, userId);
  }

  /**
   * Creates the material row before upload. The material identifier is generated
   * first so the immutable storage key can be derived from the user and material IDs.
   */
  async createForUpload(input: CreateMaterialInput, materialId?: Types.ObjectId) {
    const [material] = await Material.create([
      {
        ...(materialId ? { _id: materialId } : {}),
        userId: this.tenantId,
        originalFilename: input.originalFilename,
        storageKey: input.storageKey,
        declaredMime: input.declaredMime,
        sizeBytes: input.sizeBytes,
        uploadExpiresAt: input.uploadExpiresAt,
        status: 'awaiting_upload',
      },
    ]);
    if (!material) throw new Error('Material could not be created');
    return material;
  }

  /**
   * Paged, filtered, and sorted listing (search + status filter + sort are
   * shared with the API route and the materials page through the same query
   * schema). The search is a case-insensitive substring match on the filename.
   */
  async listPaged(params: MaterialListParams) {
    const statusGroup = params.status ?? 'all';
    const sortKey = params.sort ?? 'newest';
    const filter = {
      ...(params.q ? { originalFilename: { $regex: escapeRegex(params.q), $options: 'i' } } : {}),
      ...(materialStatusesFor(statusGroup).length > 0
        ? { status: { $in: materialStatusesFor(statusGroup) } }
        : {}),
    } as FilterQuery<IMaterial>;
    const sortField = MATERIAL_SORT_FIELDS[sortKey];
    const [data, total] = await Promise.all([
      this.list(filter, {
        skip: paginationToSkip(params),
        limit: params.limit,
        sort: { [sortField.field]: sortField.direction },
        collation: sortKey === 'name' ? { locale: 'en', strength: 2 } : undefined,
      }),
      this.count(filter),
    ]);
    return { data, total };
  }

  async findOwnedById(id: string) {
    return this.findById(id);
  }

  async transition(
    id: string | Types.ObjectId,
    from: MaterialStatus[],
    to: MaterialStatus,
    extra: Partial<IMaterial> = {},
  ) {
    return this.model
      .findOneAndUpdate(
        this.scope({ _id: id, status: { $in: from } } as FilterQuery<IMaterial>),
        { $set: { status: to, ...extra } },
        { new: true },
      )
      .exec();
  }

  async findForWorker(id: string | Types.ObjectId) {
    return Material.findById(id).exec();
  }

  async markFailed(id: string | Types.ObjectId, failureCode: string, failureMessage: string) {
    return this.model
      .findOneAndUpdate(
        this.scope({ _id: id } as FilterQuery<IMaterial>),
        { $set: { status: 'failed', failureCode, failureMessage } },
        { new: true },
      )
      .exec();
  }

  async saveParseResult(id: string | Types.ObjectId, pageCount: number | null, charCount: number) {
    return this.model
      .findOneAndUpdate(
        this.scope({ _id: id } as FilterQuery<IMaterial>),
        { $set: { pageCount, charCount } },
        { new: true },
      )
      .exec();
  }

  async markDeleted(id: string | Types.ObjectId, extra: Partial<IMaterial> = {}) {
    return this.model
      .findOneAndUpdate(
        this.scope({ _id: id } as FilterQuery<IMaterial>),
        { $set: { status: 'deleted', deletedAt: new Date(), ...extra } },
        { new: true },
      )
      .exec();
  }

  async markQuarantined(id: string | Types.ObjectId, extra: Partial<IMaterial> = {}) {
    return this.model
      .findOneAndUpdate(
        this.scope({ _id: id } as FilterQuery<IMaterial>),
        { $set: { status: 'quarantined', scanResult: 'infected', ...extra } },
        { new: true },
      )
      .exec();
  }

  async deleteOwned(id: string | Types.ObjectId) {
    return this.deleteById(id);
  }
}
