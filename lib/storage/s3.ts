import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '@/lib/env';

let client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      // v3.700+ computes a CRC32 of an EMPTY payload for presigned URLs (the
      // body is unknown at presign time); S3-compatible stores then reject the
      // real browser upload with a signature/checksum mismatch. Only compute
      // checksums when an operation actually requires one.
      requestChecksumCalculation: 'when_required',
      responseChecksumValidation: 'when_required',
    } as unknown as S3ClientConfig);
  }
  return client;
}

export function resetS3ClientForTests(): void {
  client = null;
}

export const PRESIGN_EXPIRY_SECONDS = 15 * 60;

export interface PresignedUpload {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export async function createPresignedUpload(input: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<PresignedUpload> {
  const env = getEnv();
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
  });

  const uploadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  return {
    uploadUrl,
    method: 'PUT',
    headers: {
      'Content-Type': input.contentType,
      'Content-Length': String(input.contentLength),
    },
    expiresAt: new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000),
  };
}

const globalForFakeS3 = globalThis as unknown as { __talasFakeS3?: FakeStore };

interface FakeEntry {
  bytes: Buffer;
  contentType: string;
}

interface FakeStore {
  objects: Map<string, FakeEntry>;
}

function fakeEnabled(): boolean {
  return getEnv().S3_FAKE;
}

function fakeStore(): FakeStore {
  if (!globalForFakeS3.__talasFakeS3) {
    globalForFakeS3.__talasFakeS3 = { objects: new Map() };
  }
  return globalForFakeS3.__talasFakeS3;
}

export function getFakeObjectStore(): FakeStore {
  return fakeStore();
}

export function resetFakeObjectStore(): void {
  delete globalForFakeS3.__talasFakeS3;
}

/** Ephemeral in-process object store used by the integration test stack (S3_FAKE=true). */
async function fakePutObject(input: { key: string; body: Buffer | Uint8Array; contentType: string }): Promise<void> {
  fakeStore().objects.set(input.key, {
    bytes: Buffer.from(input.body),
    contentType: input.contentType,
  });
}

async function fakeHeadObject(key: string): Promise<{ ContentLength?: number; ContentType?: string }> {
  const entry = fakeStore().objects.get(key);
  if (!entry) {
    const error = new Error('The specified key does not exist.') as Error & { name: string };
    error.name = 'NotFound';
    throw error;
  }
  return { ContentLength: entry.bytes.byteLength, ContentType: entry.contentType };
}

async function fakeGetObjectBytes(key: string, maxBytes = MAX_FAKE_BYTES): Promise<Buffer> {
  const entry = fakeStore().objects.get(key);
  if (!entry) {
    const error = new Error('The specified key does not exist.') as Error & { name: string };
    error.name = 'NotFound';
    throw error;
  }
  if (entry.bytes.byteLength > maxBytes) {
    throw new Error(`Object ${key} exceeds the maximum readable size`);
  }
  return Buffer.from(entry.bytes);
}

async function fakeGetObjectPrefixBytes(key: string, byteCount: number): Promise<Buffer> {
  return (await fakeGetObjectBytes(key, MAX_FAKE_BYTES)).subarray(0, Math.max(0, byteCount));
}

async function fakeDeleteObject(key: string): Promise<void> {
  fakeStore().objects.delete(key);
}

async function fakeDeleteObjectPrefix(prefix: string): Promise<number> {
  let removed = 0;
  for (const key of [...fakeStore().objects.keys()]) {
    if (key.startsWith(prefix)) {
      fakeStore().objects.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export async function putObject(input: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  if (fakeEnabled()) return fakePutObject(input);
  const env = getEnv();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

const MAX_FAKE_BYTES = 26_214_400;

export async function headObject(key: string) {
  if (fakeEnabled()) return fakeHeadObject(key);
  const env = getEnv();
  return getS3Client().send(
    new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
}

export async function getObjectBytes(key: string, maxBytes = 26_214_400): Promise<Buffer> {
  if (fakeEnabled()) return fakeGetObjectBytes(key, maxBytes);
  const env = getEnv();
  const response = await getS3Client().send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
  if (!response.Body) throw new Error(`Object ${key} has no body`);
  const bytes = await response.Body.transformToByteArray();
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Object ${key} exceeds the maximum readable size`);
  }
  return Buffer.from(bytes);
}

export async function getObjectPrefixBytes(
  key: string,
  byteCount: number,
): Promise<Buffer> {
  if (fakeEnabled()) return fakeGetObjectPrefixBytes(key, byteCount);
  const env = getEnv();
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Range: `bytes=0-${Math.max(0, byteCount - 1)}`,
    }),
  );
  if (!response.Body) throw new Error(`Object ${key} has no body`);
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string): Promise<void> {
  if (fakeEnabled()) return fakeDeleteObject(key);
  const env = getEnv();
  await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function deleteObjectPrefix(prefix: string): Promise<number> {
  if (fakeEnabled()) return fakeDeleteObjectPrefix(prefix);
  const env = getEnv();
  let continuationToken: string | undefined;
  let removed = 0;
  do {
    const listing = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (listing.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));
    if (keys.length > 0) {
      await getS3Client().send(
        new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
      removed += keys.length;
    }
    continuationToken = listing.IsTruncated ? listing.NextContinuationToken : undefined;
  } while (continuationToken);
  return removed;
}
