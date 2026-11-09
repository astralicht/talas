import { z } from 'zod';
import { objectIdSchema } from '@/lib/validation/common';

const baseJob = {
  materialId: objectIdSchema,
  userId: objectIdSchema,
  correlationId: z.string().min(1).max(128),
};

export const scanMaterialJobSchema = z
  .object({ type: z.literal('scan_material'), ...baseJob })
  .strict();

export const parseMaterialJobSchema = z
  .object({ type: z.literal('parse_material'), ...baseJob })
  .strict();

export const generateLessonJobSchema = z
  .object({ type: z.literal('generate_lesson'), ...baseJob })
  .strict();

export const deleteAccountJobSchema = z
  .object({
    type: z.literal('delete_account'),
    userId: objectIdSchema,
    requestId: objectIdSchema,
    correlationId: z.string().min(1).max(128),
  })
  .strict();

export const materialJobSchema = z.discriminatedUnion('type', [
  scanMaterialJobSchema,
  parseMaterialJobSchema,
  generateLessonJobSchema,
]);

export const jobPayloadSchema = z.discriminatedUnion('type', [
  scanMaterialJobSchema,
  parseMaterialJobSchema,
  generateLessonJobSchema,
  deleteAccountJobSchema,
]);

export type ScanMaterialJob = z.infer<typeof scanMaterialJobSchema>;
export type ParseMaterialJob = z.infer<typeof parseMaterialJobSchema>;
export type GenerateLessonJob = z.infer<typeof generateLessonJobSchema>;
export type DeleteAccountJob = z.infer<typeof deleteAccountJobSchema>;
export type MaterialJob = z.infer<typeof materialJobSchema>;
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const MATERIAL_QUEUE = 'material-processing';
export const ACCOUNT_DELETION_QUEUE = 'account-deletion';

export function parseJobPayload(value: unknown): JobPayload {
  return jobPayloadSchema.parse(value);
}

/**
 * Stable, idempotent job ids. BullMQ forbids `:`, `|`, `;`, and `,` in custom
 * ids, so the separator is an underscore.
 */
export function jobIdFor(type: string, materialId: string): string {
  return `${type}_${materialId}`;
}
