import archiver from 'archiver';
import { PassThrough, Readable } from 'node:stream';
import { Types } from 'mongoose';
import { Material } from '@/lib/db/models/material';
import { Lesson } from '@/lib/db/models/lesson';

export interface ExportLessonEntry {
  id: string;
  materialId: string;
  title: string;
  version: number;
  updatedAt: Date;
  markdownFile: string;
}

function safeFilename(title: string, fallback: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 80);
  return `${cleaned || 'lesson'}-${fallback}.md`;
}

/**
 * Streams a ZIP containing material metadata and every Markdown lesson owned by `userId`.
 * Only the session-derived user ID is passed in, so the export cannot widen beyond the tenant.
 */
export async function createAccountExport(
  userId: string,
): Promise<ReadableStream<Uint8Array>> {
  const tenantId = new Types.ObjectId(userId);
  const materials = await Material.find({ userId: tenantId, status: { $ne: 'deleted' } })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
  const lessons = await Lesson.find({ userId: tenantId, status: { $ne: 'deleted' } })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const lessonIndex: ExportLessonEntry[] = lessons.map((lesson) => {
    const id = lesson._id.toHexString();
    return {
      id,
      materialId: lesson.materialId.toHexString(),
      title: lesson.title,
      version: lesson.version,
      updatedAt: lesson.updatedAt,
      markdownFile: `lessons/${safeFilename(lesson.title, id.slice(-8))}`,
    };
  });

  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = new PassThrough();
  archive.on('warning', () => undefined);
  archive.on('error', (error) => output.destroy(error));
  archive.pipe(output);

  archive.append(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        materials: materials.map((material) => ({
          id: material._id.toHexString(),
          originalFilename: material.originalFilename,
          declaredMime: material.declaredMime,
          detectedMime: material.detectedMime,
          sizeBytes: material.sizeBytes,
          status: material.status,
          scanResult: material.scanResult,
          pageCount: material.pageCount,
          charCount: material.charCount,
          createdAt: material.createdAt,
        })),
      },
      null,
      2,
    ),
    { name: 'materials.json' },
  );

  lessons.forEach((lesson, index) => {
    const entry = lessonIndex[index];
    if (!entry) return;
    archive.append(lesson.contentMarkdown, { name: entry.markdownFile });
  });

  archive.append(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        lessons: lessonIndex.map(({ markdownFile, ...rest }) => ({
          ...rest,
          markdownFile,
        })),
      },
      null,
      2,
    ),
    { name: 'lessons.json' },
  );

  void archive.finalize();
  return Readable.toWeb(output) as ReadableStream<Uint8Array>;
}

export function exportFilename(now: Date = new Date()): string {
  return `talas-export-${now.toISOString().slice(0, 10)}.zip`;
}
