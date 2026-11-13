'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/http/client';
import { useMaterialStatus, type MaterialStatusResponse } from '@/hooks/use-material-status';
import { DeleteMaterialDialog } from './delete-material-dialog';
import { StatusBadge } from './status-badge';

const RETRYABLE_CODES = new Set([
  'scanner_unavailable',
  'parse_failed',
  'generation_failed',
  'provider_unavailable',
  'budget_exceeded',
  'malformed_model_output',
  'internal_error',
]);

interface StatusPanelsProps {
  materialId: string;
  initial: MaterialStatusResponse;
}

/**
 * Client-side live status for a material: fires a same-tab refresh whenever the
 * status is terminal so the server-rendered lesson appears without a reload.
 */
export function MaterialStatusPanels({ materialId, initial }: StatusPanelsProps) {
  const router = useRouter();
  const material = useMaterialStatus(materialId, initial, () => router.refresh());

  // One refresh sweep so server components see the final state right away.
  useEffect(() => {
    if (material.status === 'ready' || material.status === 'failed' || material.status === 'quarantined') {
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.status]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StatusBadge status={material.status} />
        {ACTIVE_STATUS_LABELS.has(material.status) ? (
          <span className="text-sm text-muted-foreground">
            {STAGE_LABELS[material.status] ?? 'Working…'}
          </span>
        ) : null}
      </div>

      {material.failureMessage ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:text-red-300 dark:bg-red-950/40">
          {material.failureMessage}
          {material.failureCode && RETRYABLE_CODES.has(material.failureCode) ? ' This failure can be retried.' : ''}
        </p>
      ) : null}

      {material.status === 'failed' && material.failureCode && RETRYABLE_CODES.has(material.failureCode) ? (
        <RetryButton materialId={materialId} />
      ) : null}

      <DeleteMaterialDialog materialId={materialId} />
    </div>
  );
}

function RetryButton({ materialId }: { materialId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRetry() {
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/materials/${materialId}/retry`, { method: 'POST' });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The retry failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onRetry}
        disabled={pending}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? 'Retrying…' : 'Retry processing'}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const ACTIVE_STATUS_LABELS = new Set(['awaiting_upload', 'uploaded', 'scanning', 'queued', 'processing']);

const STAGE_LABELS: Record<string, string> = {
  awaiting_upload: 'Waiting for the file upload',
  uploaded: 'Waiting to be scanned',
  scanning: 'Scanning for malware',
  queued: 'Waiting to be parsed',
  processing: 'Extracting the document text',
};
