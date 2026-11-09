import { z } from 'zod';

export const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/, 'Expected a 24-character hexadecimal identifier');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters');

export const shortTokenSchema = z.string().min(32).max(256);

export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type Pagination = z.infer<typeof paginationSchema>;

export const emptyObjectSchema = z.object({}).strict();

export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

export function paginationToSkip(pagination: Pagination): number {
  return (pagination.page - 1) * pagination.limit;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
