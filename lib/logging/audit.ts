import { Types } from 'mongoose';
import { AuditEvent } from '@/lib/db/models/audit-event';
import type { AuditEventType } from '@/lib/db/models/audit-event';
import { getLogger } from './logger';
import { getCorrelationId, hashIdentifier } from './correlation';

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'apikey',
  'secret',
  'contentmarkdown',
  'prompt',
  'filecontents',
]);

export function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactMetadata(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redactMetadata(child, depth + 1);
      }
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export interface AuditInput {
  userId?: string | Types.ObjectId | null;
  type: AuditEventType;
  correlationId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  try {
    const userId =
      typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;
    await AuditEvent.create({
      userId: userId ?? null,
      type: input.type,
      correlationId: input.correlationId ?? getCorrelationId(),
      ipHash: hashIdentifier(input.ip ?? ''),
      userAgentHash: hashIdentifier(input.userAgent ?? ''),
      metadata: redactMetadata(input.metadata ?? {}),
    });
  } catch (error) {
    getLogger().error(
      { err: error, auditType: input.type },
      'Failed to write audit event',
    );
  }
}

export function hashIp(ip: string): string {
  return hashIdentifier(ip);
}

export function hashUserAgent(userAgent: string): string {
  return hashIdentifier(userAgent);
}
