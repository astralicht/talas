import { enqueueMaterialJob } from './queues';
import type { ParseMaterialJob, ScanMaterialJob } from './schemas';

export interface MaterialJobContext {
  materialId: string;
  userId: string;
  correlationId: string;
}

export function enqueueScanForMaterial(context: MaterialJobContext): Promise<string> {
  const payload: ScanMaterialJob = {
    type: 'scan_material',
    materialId: context.materialId,
    userId: context.userId,
    correlationId: context.correlationId,
  };
  return enqueueMaterialJob(payload);
}

export function enqueueParseForMaterial(context: MaterialJobContext): Promise<string> {
  const payload: ParseMaterialJob = {
    type: 'parse_material',
    materialId: context.materialId,
    userId: context.userId,
    correlationId: context.correlationId,
  };
  return enqueueMaterialJob(payload);
}

// Lesson generation is explicit-only (specs/005): there is no automatic
// generate-stage enqueue for materials anymore. Lesson creation is requested
// through the lesson-generation flow, which enqueues its own job payload
// (see generateLessonRequestJobSchema in lib/jobs/schemas.ts).
