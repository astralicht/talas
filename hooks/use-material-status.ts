'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '@/lib/http/client';

export interface MaterialStatusResponse {
  id: string;
  originalFilename: string;
  detectedMime: string | null;
  sizeBytes: number;
  status: string;
  scanResult: string;
  pageCount: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  attempts: number;
  updatedAt: string;
}

/** Statuses that are still moving; anything else ends the poll loop. */
const ACTIVE_STATUSES = new Set([
  'awaiting_upload',
  'uploaded',
  'scanning',
  'queued',
  'processing',
]);

const INITIAL_DELAY_MS = 2_000;
const MAX_DELAY_MS = 10_000;

/**
 * Polls the material status endpoint with capped exponential backoff. Polling
 * pauses while the tab is hidden and stops on unmount or a terminal status.
 */
export function useMaterialStatus(
  materialId: string,
  initial: MaterialStatusResponse,
  onSettled?: (status: MaterialStatusResponse) => void,
): MaterialStatusResponse {
  const [status, setStatus] = useState<MaterialStatusResponse>(initial);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    const delay = () => Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);

    const poll = async () => {
      if (document.visibilityState !== 'visible') {
        setTimeoutSafe(poll, MAX_DELAY_MS);
        return;
      }
      try {
        const next = await apiRequest<MaterialStatusResponse>(`/api/materials/${materialId}/status`);
        if (cancelled) return;
        const previousProgress = status.updatedAt;
        const active = ACTIVE_STATUSES.has(next.status);
        setStatus((previous) => ({ ...previous, ...next }));
        if (!active) {
          settledRef.current?.(next);
          return;
        }
        attempt = next.updatedAt === previousProgress ? attempt + 1 : 0;
        setTimeoutSafe(poll, delay());
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return;
        attempt += 1;
        setTimeoutSafe(poll, delay());
      }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const setTimeoutSafe = (fn: () => void, ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        attempt = 0;
        setTimeoutSafe(poll, 250);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    setTimeoutSafe(poll, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId]);

  return status;
}
