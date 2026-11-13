import { writeAuditEvent } from './audit';
import type { AuditEventType } from '@/lib/db/models/audit-event';

export interface AuditEventContext {
  userId?: string | null;
  correlationId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export function emitAudit(type: AuditEventType, context: AuditEventContext = {}): Promise<void> {
  return writeAuditEvent({ type, ...context });
}

export const auditEvents = {
  generationRequested: (context: AuditEventContext = {}) =>
    emitAudit('generation_requested', context),
  registration: (context: AuditEventContext = {}) => emitAudit('registration', context),
  verificationSent: (context: AuditEventContext = {}) => emitAudit('verification_sent', context),
  emailVerified: (context: AuditEventContext = {}) => emitAudit('email_verified', context),
  signIn: (context: AuditEventContext = {}) => emitAudit('sign_in', context),
  signInFailed: (context: AuditEventContext = {}) => emitAudit('sign_in_failed', context),
  accountLocked: (context: AuditEventContext = {}) => emitAudit('account_locked', context),
  tokenRefresh: (context: AuditEventContext = {}) => emitAudit('token_refresh', context),
  refreshReuse: (context: AuditEventContext = {}) => emitAudit('refresh_reuse_detected', context),
  signOut: (context: AuditEventContext = {}) => emitAudit('sign_out', context),
  passwordResetRequested: (context: AuditEventContext = {}) =>
    emitAudit('password_reset_requested', context),
  passwordResetCompleted: (context: AuditEventContext = {}) =>
    emitAudit('password_reset_completed', context),
  exportRequested: (context: AuditEventContext = {}) => emitAudit('export_requested', context),
  accountDeletionRequested: (context: AuditEventContext = {}) =>
    emitAudit('account_deletion_requested', context),
  accountDeleted: (context: AuditEventContext = {}) => emitAudit('account_deleted', context),
  authorizationDenied: (context: AuditEventContext = {}) =>
    emitAudit('authorization_denied', context),
  uploadConfirmed: (context: AuditEventContext = {}) => emitAudit('upload_confirmed', context),
  scanClean: (context: AuditEventContext = {}) => emitAudit('scan_clean', context),
  scanInfected: (context: AuditEventContext = {}) => emitAudit('scan_infected', context),
  scanUnavailable: (context: AuditEventContext = {}) => emitAudit('scan_unavailable', context),
  generationSucceeded: (context: AuditEventContext = {}) =>
    emitAudit('generation_succeeded', context),
  generationFailed: (context: AuditEventContext = {}) => emitAudit('generation_failed', context),
  materialRetry: (context: AuditEventContext = {}) => emitAudit('material_retry', context),
  materialDeleted: (context: AuditEventContext = {}) => emitAudit('material_deleted', context),
  materialDownloaded: (context: AuditEventContext = {}) =>
    emitAudit('material_downloaded', context),
  lessonSaved: (context: AuditEventContext = {}) => emitAudit('lesson_saved', context),
  revisionRestored: (context: AuditEventContext = {}) => emitAudit('revision_restored', context),
  lessonDeleted: (context: AuditEventContext = {}) => emitAudit('lesson_deleted', context),
};
