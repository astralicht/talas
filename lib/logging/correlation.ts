import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

export interface CorrelationContext {
  correlationId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function newCorrelationId(): string {
  return randomUUID();
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? newCorrelationId();
}

export function runWithCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function bindCorrelation<T extends (...args: never[]) => unknown>(
  context: CorrelationContext,
  fn: T,
): T {
  return ((...args: Parameters<T>) => storage.run(context, () => fn(...args))) as T;
}

export function hashIdentifier(value: string | null | undefined): string {
  return createHash('sha256').update(value ?? '').digest('hex');
}
