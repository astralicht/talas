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
  awaiting_upload: 'bg-muted text-foreground',
  uploaded: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  scanning: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  queued: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  processing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  quarantined: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  deleted: 'bg-muted text-foreground',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? 'bg-muted text-foreground'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
