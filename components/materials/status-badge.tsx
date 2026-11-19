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
  awaiting_upload: 'bg-muted text-muted-foreground',
  uploaded: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  scanning: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  queued: 'bg-accent-100 text-accent-600 dark:bg-accent-200/20 dark:text-accent-200',
  processing: 'bg-accent-100 text-accent-600 dark:bg-accent-200/20 dark:text-accent-200',
  ready: 'bg-accent-100 text-accent-600 dark:bg-accent-200/20 dark:text-accent-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  quarantined: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  deleted: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
        STATUS_STYLES[status] ?? 'bg-muted text-foreground'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
