const STATUS_LABELS: Record<string, string> = {
  awaiting_upload: 'Awaiting upload',
  uploaded: 'Uploaded',
  scanning: 'Scanning',
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
  quarantined: 'Quarantined',
  deleted: 'Deleted',
};

const STATUS_STYLES: Record<string, string> = {
  awaiting_upload: 'bg-slate-100 text-slate-700',
  uploaded: 'bg-sky-100 text-sky-800',
  scanning: 'bg-sky-100 text-sky-800',
  queued: 'bg-indigo-100 text-indigo-800',
  processing: 'bg-indigo-100 text-indigo-800',
  ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  quarantined: 'bg-red-100 text-red-800',
  deleted: 'bg-slate-100 text-slate-500',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
