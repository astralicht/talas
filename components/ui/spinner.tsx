export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin text-current ${className}`}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <Spinner className="h-4 w-4" />
      {label ? <span>{label}</span> : null}
      <span className="sr-only">Loading</span>
    </span>
  );
}
