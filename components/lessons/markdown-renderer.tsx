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
    <div className="markdown-body prose prose-slate max-w-none">
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
        }}
      >
        {safe}
      </ReactMarkdown>
    </div>
  );
}
