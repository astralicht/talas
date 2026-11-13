import type { IMaterial } from '@/lib/db/models/material';
import type { ILesson } from '@/lib/db/models/lesson';
import type { ILessonGenerationRequest } from '@/lib/db/models/lesson-generation-request';
import type { ILessonRevision } from '@/lib/db/models/lesson-revision';

export interface MaterialView {
  id: string;
  originalFilename: string;
  detectedMime: string | null;
  sizeBytes: number;
  status: IMaterial['status'];
  scanResult: IMaterial['scanResult'];
  pageCount: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
}

export function serializeMaterial(material: IMaterial): MaterialView {
  return {
    id: material._id.toHexString(),
    originalFilename: material.originalFilename,
    detectedMime: material.detectedMime,
    sizeBytes: material.sizeBytes,
    status: material.status,
    scanResult: material.scanResult,
    pageCount: material.pageCount,
    failureCode: material.failureCode,
    failureMessage: material.failureMessage,
    createdAt: material.createdAt,
  };
}

export interface LessonSummaryView {
  id: string;
  title: string;
  version: number;
  updatedAt: Date;
}

export interface LessonView {
  id: string;
  materialId: string;
  title: string;
  summary: string;
  contentMarkdown: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeLessonSummary(lesson: ILesson): LessonSummaryView {
  return {
    id: lesson._id.toHexString(),
    title: lesson.title,
    version: lesson.version,
    updatedAt: lesson.updatedAt,
  };
}

export function serializeLesson(lesson: ILesson): LessonView {
  return {
    id: lesson._id.toHexString(),
    materialId: lesson.materialId.toHexString(),
    title: lesson.title,
    summary: lesson.summary,
    contentMarkdown: lesson.contentMarkdown,
    version: lesson.version,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}

export interface LessonGenerationRequestView {
  requestId: string;
  status: ILessonGenerationRequest['status'];
  title: string;
  materialIds: string[];
  lessonId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export function serializeLessonGenerationRequest(
  request: ILessonGenerationRequest,
): LessonGenerationRequestView {
  return {
    requestId: request._id.toHexString(),
    status: request.status,
    title: request.title,
    materialIds: request.materialIds.map((id) => id.toHexString()),
    lessonId: request.lessonId ? request.lessonId.toHexString() : null,
    lastErrorCode: request.lastErrorCode,
    lastErrorMessage: request.lastErrorMessage,
  };
}

export interface RevisionView {
  id: string;
  version: number;
  authorType: ILessonRevision['authorType'];
  createdAt: Date;
}

export function serializeRevision(revision: ILessonRevision): RevisionView {
  return {
    id: revision._id.toHexString(),
    version: revision.version,
    authorType: revision.authorType,
    createdAt: revision.createdAt,
  };
}
