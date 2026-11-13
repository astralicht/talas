'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sanitizeMarkdown } from '@/lib/security/sanitize';

/**
 * Shared, XSS-safe Markdown renderer. Sanitizing happens before parsing, there
 * is no `rehype-raw`, so the preview and the final render are byte-identical.
 */
export function MarkdownRenderer({ content }: { content: string }) {
  const safe = useMemo(() => sanitizeMarkdown(content), [content]);

  return (
    <div className="markdown-body prose prose-slate dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              rel="noopener noreferrer nofollow"
              className="text-brand-600 underline"
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === 'string' ? src : ''}
              alt={alt ?? 'Figure'}
              // FR-008: responsive figures; the sources are tenant-scoped
              // cookie-authenticated routes (Cache-Control private).
              className="mx-auto max-w-full h-auto rounded-md border border-border dark:border-slate-700"
              loading="lazy"
            />
          ),
        }}
      >
        {safe}
      </ReactMarkdown>
    </div>
  );
}
