import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../lib/db/connection';
import { User } from '../lib/db/models/user';
import { Material } from '../lib/db/models/material';
import { Lesson } from '../lib/db/models/lesson';
import { LessonRevision } from '../lib/db/models/lesson-revision';
import { hashPassword } from '../lib/auth/password';
import { putObject } from '../lib/storage/s3';

const SEED_PASSWORD = 'talas-local-password';

const USERS = [
  { email: 'alice@talas.local', label: 'Alice' },
  { email: 'bob@talas.local', label: 'Bob' },
];

const SAMPLE_MARKDOWN = `# Photosynthesis

Photosynthesis converts light energy into chemical energy stored in glucose.

## Key stages

1. Light reactions in the thylakoid membrane
2. The Calvin cycle in the stroma

## Inputs and outputs

| Input | Output |
|---|---|
| Carbon dioxide | Glucose |
| Water | Oxygen |
| Light | ATP and NADPH |
`;

async function seedUser(email: string): Promise<Types.ObjectId> {
  const normalized = email.toLowerCase();
  const existing = await User.findOne({ email: normalized }).exec();
  if (existing) {
    if (!existing.emailVerifiedAt) {
      existing.emailVerifiedAt = new Date();
      await existing.save();
    }
    return existing._id;
  }

  const user = await User.create({
    email: normalized,
    passwordHash: await hashPassword(SEED_PASSWORD),
    emailVerifiedAt: new Date(),
    status: 'active',
  });
  return user._id;
}

async function seedSampleLesson(userId: Types.ObjectId): Promise<void> {
  const materialId = new Types.ObjectId();
  const storageKey = `materials/${userId.toHexString()}/${materialId.toHexString()}`;

  const existing = await Material.findOne({ userId, storageKey }).exec();
  if (existing) return;

  const body = Buffer.from(SAMPLE_MARKDOWN, 'utf8');
  try {
    await putObject({ key: storageKey, body, contentType: 'text/markdown' });
  } catch (error) {
    console.warn(
      `Sample object could not be uploaded to storage (is MinIO running?): ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  await Material.create({
    _id: materialId,
    userId,
    originalFilename: 'photosynthesis.md',
    storageKey,
    declaredMime: 'text/markdown',
    detectedMime: 'text/markdown',
    sizeBytes: body.byteLength,
    status: 'ready',
    scanResult: 'clean',
    charCount: SAMPLE_MARKDOWN.length,
    uploadExpiresAt: new Date(),
  });

  const lesson = await Lesson.create({
    userId,
    materialId,
    title: 'Photosynthesis Foundations',
    summary: 'How light energy becomes chemical energy.',
    contentMarkdown: SAMPLE_MARKDOWN,
    version: 1,
    status: 'ready',
    generationProvider: 'seed',
    generationModel: 'seed',
    promptVersion: 'v1',
  });

  await LessonRevision.create({
    userId,
    lessonId: lesson._id,
    version: 1,
    title: lesson.title,
    contentMarkdown: lesson.contentMarkdown,
    authorType: 'system',
  });
}

async function main(): Promise<void> {
  await connectDb();
  for (const user of USERS) {
    const userId = await seedUser(user.email);
    if (user.email === 'alice@talas.local') {
      await seedSampleLesson(userId);
    }
    console.log(`Seeded ${user.label}: ${user.email}`);
  }
  console.log(`Seed password for both accounts: ${SEED_PASSWORD}`);
  await disconnectDb();
}

main().catch(async (error: unknown) => {
  console.error('Seed failed', error);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
