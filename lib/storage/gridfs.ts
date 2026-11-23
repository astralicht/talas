import mongoose from 'mongoose';

/**
 * GridFS object-storage driver (TODO step 11). Blob bytes live in the same
 * MongoDB database as the app data — filenames keep the S3-era key scheme
 * (`materials/{userId}/{materialId}`, `.../images/{assetId}`) so call sites
 * and the data model are untouched. Errors mirror the previous driver's
 * contract: a missing object throws with `name: 'NotFound'` (the upload
 * confirm flow maps that to `upload_missing`).
 */
const BUCKET_NAME = 'objects';

function bucket(): mongoose.mongo.GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Object storage requires an active mongoose connection');
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });
}

function notFoundError(key: string): Error & { name: string } {
  const error = new Error(`The specified key does not exist: ${key}`) as Error & { name: string };
  error.name = 'NotFound';
  return error;
}

async function findFile(key: string): Promise<mongoose.mongo.GridFSFile | null> {
  const [file] = await bucket().find({ filename: key }).limit(1).toArray();
  return file ?? null;
}

export async function putObject(input: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  const upload = bucket().openUploadStream(input.key, { contentType: input.contentType });
  await new Promise<void>((resolve, reject) => {
    upload.once('error', reject);
    upload.once('finish', () => resolve());
    upload.end(input.body);
  });
}

export async function headObject(
  key: string,
): Promise<{ ContentLength?: number; ContentType?: string }> {
  const file = await findFile(key);
  if (!file) throw notFoundError(key);
  return { ContentLength: file.length, ContentType: file.contentType };
}

async function collect(stream: mongoose.mongo.GridFSBucketReadStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function getObjectBytes(key: string, maxBytes = 26_214_400): Promise<Buffer> {
  const file = await findFile(key);
  if (!file) throw notFoundError(key);
  if (file.length > maxBytes) {
    throw new Error(`Object ${key} exceeds the maximum readable size`);
  }
  return collect(bucket().openDownloadStreamByName(key));
}

export async function getObjectPrefixBytes(key: string, byteCount: number): Promise<Buffer> {
  if (byteCount <= 0) return Buffer.alloc(0);
  const file = await findFile(key);
  if (!file) throw notFoundError(key);
  // Read at most one chunk past the prefix — GridFS chunks are 255 KiB, so the
  // magic-byte check never pulls more than that from storage.
  const stream = bucket().openDownloadStreamByName(key);
  const chunks: Buffer[] = [];
  let remaining = byteCount;
  for await (const chunk of stream) {
    const slice = chunk as Buffer;
    if (slice.length > remaining) {
      chunks.push(slice.subarray(0, remaining));
      break;
    }
    chunks.push(slice);
    remaining -= slice.length;
    if (remaining <= 0) break;
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  const file = await findFile(key);
  if (!file) return; // Deleting an absent key is a no-op, matching the old driver.
  await bucket().delete(file._id);
}

export async function deleteObjectPrefix(prefix: string): Promise<number> {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const files = await bucket()
    .find({ filename: { $regex: `^${escaped}` } })
    .toArray();
  for (const file of files) {
    await bucket().delete(file._id);
  }
  return files.length;
}
