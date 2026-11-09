'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';

const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
];

const MAX_SIZE_BYTES = 26_214_400;

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
 */
export function UploadForm({ verified }: { verified: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'presigning' | 'uploading' | 'confirming'>('idle');
  const [progress, setProgress] = useState(0);

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setStage('idle');
    setProgress(0);
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      return;
    }
    const extension = extensionFor(selected.name);
    const declared = MIME_BY_EXTENSION[extension];
    if (!declared || !ACCEPTED_MIME_TYPES.includes(selected.type === '' ? declared : selected.type)) {
      setError('Use a PDF, DOCX, Markdown, or plain-text file (25 MB or smaller).');
      event.target.value = '';
      setFile(null);
      return;
    }
    if (selected.size < 1 || selected.size > MAX_SIZE_BYTES) {
      setError('Files must be 25 MB or smaller and not empty.');
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

    try {
      setStage('presigning');
      setProgress(5);
      const presigned = await apiRequest<PresignResponse>('/api/materials/presign', {
        method: 'POST',
        body: { filename: file.name, declaredMime: declared, sizeBytes: file.size },
      });

      setStage('uploading');
      setProgress(30);
      const response = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: presigned.headers,
        body: file,
      });
      if (!response.ok) {
        throw new Error('The file upload failed. Try again.');
      }
      setProgress(85);

      setStage('confirming');
      await apiRequest('/api/materials', {
        method: 'POST',
        body: { materialId: presigned.materialId },
      });
      setProgress(100);

      router.push(`/materials/${presigned.materialId}`);
    } catch (cause) {
      setStage('idle');
      setProgress(0);
      setError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message || 'The upload failed. Try again.'
          : 'The upload failed. Try again.',
      );
    }
  }

  const pending = stage !== 'idle';

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1">
        <label htmlFor="material-file" className="text-sm font-medium text-slate-800">
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
          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-700"
        />
        <p className="text-xs text-slate-500">
          PDF, DOCX, Markdown, or plain text, up to 25 MB.
        </p>
      </div>

      {pending ? (
        <div role="status">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {stage === 'presigning' && 'Requesting upload…'}
            {stage === 'uploading' && 'Uploading file…'}
            {stage === 'confirming' && 'Verifying and processing…'}
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!verified || pending || !file}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {verified ? 'Upload material' : 'Verify your email to upload'}
      </button>
    </form>
  );
}
