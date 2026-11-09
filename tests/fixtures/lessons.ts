import { Types } from 'mongoose';

export interface TestLesson {
  id: Types.ObjectId;
  userId: Types.ObjectId;
  materialId: Types.ObjectId;
  title: string;
  summary: string;
  contentMarkdown: string;
  version: number;
  status: 'draft' | 'ready' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
}

export function makeLesson(
  userId: Types.ObjectId,
  materialId: Types.ObjectId,
  input: Partial<Omit<TestLesson, 'id' | 'userId' | 'materialId'>> = {},
): TestLesson {
  return {
    id: new Types.ObjectId(),
    userId,
    materialId,
    title: input.title ?? 'Cell Biology Foundations',
    summary: input.summary ?? 'A structured overview of the cell.',
    contentMarkdown:
      input.contentMarkdown ?? '# Cell Biology\n\n- Membranes\n- Organelles\n',
    version: input.version ?? 1,
    status: input.status ?? 'ready',
    createdAt: input.createdAt ?? new Date(),
    updatedAt: input.updatedAt ?? new Date(),
  };
}

export function makeRevision(
  lessonId: Types.ObjectId,
  userId: Types.ObjectId,
  version = 1,
  authorType: 'system' | 'user' = 'system',
) {
  return {
    id: new Types.ObjectId(),
    lessonId,
    userId,
    version,
    title: 'Cell Biology Foundations',
    contentMarkdown: '# Cell Biology\n',
    authorType,
    createdAt: new Date(),
  };
}
