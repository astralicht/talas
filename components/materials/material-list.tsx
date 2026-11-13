import Link from 'next/link';
import type { IMaterial } from '@/lib/db/models/material';
import { StatusBadge } from './status-badge';

export function MaterialList({ materials }: { materials: IMaterial[] }) {
  return (
    <ul className="divide-y divide-border">
      {materials.map((material) => (
        <li key={material._id.toHexString()} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <Link
              href={`/materials/${material._id.toHexString()}`}
              className="block truncate font-medium text-foreground hover:text-brand-600"
            >
              {material.originalFilename}
            </Link>
            <p className="text-xs text-muted-foreground">
              {formatBytes(material.sizeBytes)}
              {material.pageCount !== null ? ` · ${material.pageCount} pages` : ''}
            </p>
          </div>
          <StatusBadge status={material.status} />
        </li>
      ))}
    </ul>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
