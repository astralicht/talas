import { Types } from 'mongoose';
import { getLogger } from '@/lib/logging/logger';
import { MaterialAsset, type IMaterialAsset } from '@/lib/db/models/material-asset';
import { deleteObjectPrefix, putObject } from '@/lib/storage/s3';
import type { ExtractedImage } from '@/lib/parsing/types';

/** Server-owned S3 layout for extracted images (specs/005 FR-008). */
export function assetKeyFor(
  userId: string | Types.ObjectId,
  materialId: string | Types.ObjectId,
  assetId: string | Types.ObjectId,
): string {
  const owner = typeof userId === 'string' ? userId : userId.toHexString();
  const material = typeof materialId === 'string' ? materialId : materialId.toHexString();
  const asset = typeof assetId === 'string' ? assetId : assetId.toHexString();
  return `materials/${owner}/${material}/images/${asset}`;
}

/**
 * Persists extracted images as tenant-scoped MaterialAsset rows plus S3
 * objects. Best-effort by design: a single failed asset is skipped (and its
 * position marker removed from the surviving set), but parse results and
 * pipeline progress are never affected. Returns the stored assets in order.
 */
export async function persistMaterialAssets(
  userId: string,
  materialId: string,
  images: ExtractedImage[],
): Promise<IMaterialAsset[]> {
  if (images.length === 0) return [];

  const logger = getLogger();
  const stored: IMaterialAsset[] = [];

  for (const image of images) {
    try {
      const [asset] = await MaterialAsset.create([
        {
          userId: new Types.ObjectId(userId),
          materialId: new Types.ObjectId(materialId),
          // Unique temporary key (the real key embeds the row id); replaced
          // after the row exists so the S3 layout stays server-owned.
          assetKey: `pending-${new Types.ObjectId().toHexString()}`,
          contentType: image.contentType,
          byteSize: image.data.byteLength,
          pageNumber: image.pageNumber ?? null,
          width: image.width ?? null,
          height: image.height ?? null,
        },
      ]);
      if (!asset) throw new Error('Asset row could not be created');

      const key = assetKeyFor(userId, materialId, asset._id);
      await putObject({ key, body: image.data, contentType: image.contentType });
      const updated = await MaterialAsset.findByIdAndUpdate(
        asset._id,
        { $set: { assetKey: key } },
        { new: true },
      ).exec();
      if (updated) stored.push(updated);
    } catch (error) {
      logger.warn({ err: error, materialId }, 'Image asset could not be stored; skipped');
    }
  }

  return stored;
}

/** Removes every stored image of a material (used by the delete cascade). */
export async function deleteMaterialAssets(userId: string, materialId: string): Promise<number> {
  const assets = await MaterialAsset.find({ userId: new Types.ObjectId(userId), materialId })
    .lean()
    .exec();
  if (assets.length === 0) return 0;

  let removed = 0;
  try {
    removed = await deleteObjectPrefix(`materials/${userId}/${materialId}/images/`);
  } catch (error) {
    getLogger().warn({ err: error, materialId }, 'Image asset cleanup failed during deletion');
  }
  await MaterialAsset.deleteMany({ userId: new Types.ObjectId(userId), materialId }).exec();
  return removed;
}
