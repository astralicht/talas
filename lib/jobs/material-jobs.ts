import { enqueueMaterialJob } from './queues';
import type { GenerateLessonJob, ParseMaterialJob, ScanMaterialJob } from './schemas';

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

export function enqueueGenerateForMaterial(context: MaterialJobContext): Promise<string> {
  const payload: GenerateLessonJob = {
    type: 'generate_lesson',
    materialId: context.materialId,
    userId: context.userId,
    correlationId: context.correlationId,
  };
  return enqueueMaterialJob(payload);
}
