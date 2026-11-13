import { connectDb, disconnectDb } from '../lib/db/connection';
import {
  AccountDeletionRequest,
  AuditEvent,
  EmailVerificationToken,
  Lesson,
  LessonGenerationRequest,
  LessonRevision,
  Material,
  MaterialAsset,
  PasswordResetToken,
  ProcessingJob,
  RefreshToken,
  User,
} from '../lib/db/models';

const models = [
  User,
  RefreshToken,
  EmailVerificationToken,
  PasswordResetToken,
  Material,
  ProcessingJob,
  MaterialAsset,
  Lesson,
  LessonGenerationRequest,
  LessonRevision,
  AuditEvent,
  AccountDeletionRequest,
];

async function main(): Promise<void> {
  await connectDb();
  for (const model of models) {
    await model.syncIndexes();
    console.log(`Indexes synchronized: ${model.modelName}`);
  }
  await disconnectDb();
}

main().catch(async (error: unknown) => {
  console.error('Index synchronization failed', error);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
