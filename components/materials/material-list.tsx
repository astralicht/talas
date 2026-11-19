import Link from 'next/link';
import type { IMaterial } from '@/lib/db/models/material';
import { StatusBadge } from './status-badge';
import { DeleteMaterialDialog } from './delete-material-dialog';

export function MaterialList({ materials }: { materials: IMaterial[] }) {
  return (
    <ul className="divide-border divide-y">
      {materials.map((material) => (
        <li
          key={material._id.toHexString()}
          className="flex items-center justify-between gap-3 py-3"
        >
          <div className="min-w-0">
            <Link
              href={`/materials/${material._id.toHexString()}`}
              className="hover:text-brand-700 text-foreground block truncate font-medium"
            >
              {material.originalFilename}
            </Link>
            <p className="text-muted-foreground text-xs">
              {formatBytes(material.sizeBytes)}
              {material.pageCount !== null ? ` · ${material.pageCount} pages` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatusBadge status={material.status} />
            <DeleteMaterialDialog materialId={material._id.toHexString()} />
          </div>
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
