'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';
import { Button } from '@/components/ui/button';

const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
];

const MAX_SIZE_BYTES = 157_286_400;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
};

interface PresignResponse {
  materialId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

function extensionFor(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? `.${match[1]?.toLowerCase()}` : '';
}

/**
 * Upload form with client-side pre-checks (type and size), progress reporting,
 * and safe error display. The heavy validation is repeated server-side.
 *
 * Transport (constitution v2.4.0): the file PUTs to the authenticated
 * application route, which writes it into the object store server-side — the
 * flow is identical on localhost and behind the dev tunnel. Presign still
 * creates the record and applies quota; confirm still verifies the object.
 *
 * Every presign creates a real record, so the attempt is cancellable: the
 * Cancel button (and the "clear this attempt" action after a failure) deletes
 * it through the normal deletion flow, reclaiming the quota slot.
 */
export function UploadForm({ verified }: { verified: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'presigning' | 'uploading' | 'confirming'>('idle');
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setStage('idle');
    setProgress(0);
    setAttempt(null);
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      return;
    }
    const extension = extensionFor(selected.name);
    const declared = MIME_BY_EXTENSION[extension];
    if (
      !declared ||
      !ACCEPTED_MIME_TYPES.includes(selected.type === '' ? declared : selected.type)
    ) {
      setError('Use a PDF, DOCX, Markdown, or plain-text file (150 MB or smaller).');
      event.target.value = '';
      setFile(null);
      return;
    }
    if (selected.size < 1 || selected.size > MAX_SIZE_BYTES) {
      setError('Files must be 150 MB or smaller and not empty.');
      event.target.value = '';
      setFile(null);
      return;
    }
    setFile(selected);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setError(null);
    const extension = extensionFor(file.name);
    const declared = MIME_BY_EXTENSION[extension] ?? file.type;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setStage('presigning');
      setProgress(5);
      const presigned = await apiRequest<PresignResponse>('/api/materials/presign', {
        method: 'POST',
        body: { filename: file.name, declaredMime: declared, sizeBytes: file.size },
        signal: controller.signal,
      });
      setAttempt(presigned.materialId);

      setStage('uploading');
      setProgress(30);
      await apiRequest(`/api/materials/${presigned.materialId}/upload`, {
        method: 'PUT',
        body: file,
        signal: controller.signal,
      });
      setProgress(85);

      setStage('confirming');
      await apiRequest('/api/materials', {
        method: 'POST',
        body: { materialId: presigned.materialId },
        signal: controller.signal,
      });
      setProgress(100);

      abortRef.current = null;
      router.push(`/materials/${presigned.materialId}`);
    } catch (cause) {
      abortRef.current = null;
      if (cause instanceof Error && cause.name === 'AbortError') {
        return; // the Cancel handler owns cleanup
      }
      setStage('idle');
      setProgress(0);
      setError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message || 'The upload failed. Try again.'
          : 'The upload failed. Try again.',
      );
    }
  }

  /** Aborts the in-flight request and deletes the attempt's record. */
  async function onCancel() {
    const attemptId = attempt;
    abortRef.current?.abort();
    abortRef.current = null;
    setStage('idle');
    setProgress(0);
    setError(null);
    setAttempt(null);
    if (attemptId) {
      try {
        await apiRequest(`/api/materials/${attemptId}`, { method: 'DELETE' });
      } catch {
        setError('The attempt could not be discarded. Delete it from the materials list.');
      }
    }
  }

  /** Deletes the record a failed attempt created so the quota slot is reclaimed. */
  async function onClearAttempt() {
    const attemptId = attempt;
    if (!attemptId) return;
    setClearing(true);
    try {
      await apiRequest(`/api/materials/${attemptId}`, { method: 'DELETE' });
      setError(null);
      setAttempt(null);
      if (inputRef.current) inputRef.current.value = '';
      setFile(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The attempt could not be discarded.');
    } finally {
      setClearing(false);
    }
  }

  const pending = stage !== 'idle';

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1">
        <label htmlFor="material-file" className="text-foreground text-sm font-medium">
          Study material
        </label>
        <input
          ref={inputRef}
          id="material-file"
          name="material-file"
          type="file"
          accept=".pdf,.docx,.md,.markdown,.txt"
          onChange={onFileSelected}
          disabled={!verified || pending}
          className="border-input bg-card file:bg-brand-100 file:text-brand-700 block w-full rounded-lg border px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:px-3 file:py-1.5 file:font-semibold"
        />
        <p className="text-muted-foreground text-xs">
          PDF, DOCX, Markdown, or plain text, up to 150 MB.
        </p>
      </div>

      {pending ? (
        <div role="status">
          <div className="bg-border h-2 w-full overflow-hidden rounded-full">
            <div className="bg-brand-500 h-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {stage === 'presigning' && 'Requesting upload…'}
            {stage === 'uploading' && 'Uploading file…'}
            {stage === 'confirming' && 'Verifying and processing…'}
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {!pending && attempt && error ? (
        <Button
          variant="danger"
          size="sm"
          onClick={onClearAttempt}
          disabled={clearing}
          data-testid="clear-upload-attempt"
        >
          {clearing ? 'Discarding…' : 'Discard this attempt'}
        </Button>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!verified || pending || !file}>
          {verified ? 'Upload material' : 'Verify your email to upload'}
        </Button>
        {pending ? (
          <Button variant="outline" onClick={onCancel} data-testid="cancel-upload">
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
