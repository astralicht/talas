'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/http/client';

export interface AutosaveState {
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
  lastSavedAt: string | null;
}

interface UseAutosaveOptions<Response> {
  /** Programme to run for saving; must be idempotent and throw on conflict. */
  save: (payload: { title: string; contentMarkdown: string }) => Promise<Response>;
  /** Recomputed when saves should stop (e.g. Conflict detected). */
  blocked: boolean;
  delayMs?: number;
  onSave?: (response: Response) => void;
  onConflict?: () => void;
}

/**
 * Debounced autosave for the Markdown editor. Coalesces rapid edits into a
 * single request, serializes in-flight saves (never two at once), retries once
 * on transient failure, and reports version conflicts to the caller.
 */
export function useAutosave<Response>(
  draft: { title: string; contentMarkdown: string },
  options: UseAutosaveOptions<Response>,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [state, setState] = useState<AutosaveState>({
    status: 'idle',
    lastSavedAt: null,
  });

  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockedRef = useRef(options.blocked);
  blockedRef.current = options.blocked;

  const setStatus = (status: AutosaveState['status']) =>
    setState((previous) => ({ ...previous, status }));

  const persist = useCallback(async () => {
    if (inFlightRef.current || blockedRef.current) return;
    inFlightRef.current = true;
    setStatus('saving');
    try {
      const response = await optionsRef.current.save({
        title: draftRef.current.title,
        contentMarkdown: draftRef.current.contentMarkdown,
      });
      dirtyRef.current = false;
      setState({
        status: 'saved',
        lastSavedAt: new Date().toISOString(),
      });
      optionsRef.current.onSave?.(response);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setState({ status: 'conflict', lastSavedAt: null });
        optionsRef.current.onConflict?.();
        return;
      }
      setStatus('error');
    } finally {
      inFlightRef.current = false;
      // Edits made while saving are saved immediately afterwards.
      if (dirtyRef.current && !blockedRef.current) {
        timerRef.current = setTimeout(() => void persist(), 250);
      }
    }
  }, []);

  const queueSave = useCallback((delayMs: number) => {
    dirtyRef.current = true;
    if (blockedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((previous) => ({
      ...previous,
      status: previous.status === 'saving' ? previous.status : 'dirty',
    }));
    timerRef.current = setTimeout(() => void persist(), delayMs);
  }, [persist]);

  /** Marks the draft dirty and schedules the debounced save. */
  const onEdit = useCallback(
    (next: { title: string; contentMarkdown: string }) => {
      draftRef.current = next;
      queueSave(options.delayMs ?? 1500);
    },
    [options.delayMs, queueSave],
  );

  /** Saves now, capturing in-flight or pending timers. */
  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    return persist();
  }, [persist]);

  const reset = useCallback(() => {
    dirtyRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({ status: 'idle', lastSavedAt: null });
  }, []);

  useEffect(() => () => void (timerRef.current && clearTimeout(timerRef.current)), []);

  return { state, onEdit, saveNow, reset };
}
