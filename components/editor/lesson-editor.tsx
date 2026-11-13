'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/http/client';
import { useAutosave } from '@/hooks/use-autosave';
import { MarkdownRenderer } from '@/components/lessons/markdown-renderer';
import { ConflictBanner } from './conflict-banner';
import {
  RevisionHistory,
  fetchRevisions,
  type RevisionSummary,
} from './revision-history';

export interface LessonEditorProps {
  lessonId: string;
  initialTitle: string;
  initialContentMarkdown: string;
  initialVersion: number;
  initialRevisions: RevisionSummary[];
}

interface SaveResponse {
  lesson: {
    title: string;
    contentMarkdown: string;
    version: number;
  };
  revision: RevisionSummary;
}

/**
 * Side-by-side Markdown editor with live preview, keyboard shortcuts, debounced
 * autosave, conflict detection, and revision restore. The preview and the final
 * render use the identical sanitizer/renderer configuration, so they never diverge.
 */
export function LessonEditor({
  lessonId,
  initialTitle,
  initialContentMarkdown,
  initialVersion,
  initialRevisions,
}: LessonEditorProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContentMarkdown);
  const [version, setVersion] = useState(initialVersion);
  const [revisions, setRevisions] = useState<RevisionSummary[]>(initialRevisions);
  const [conflict, setConflict] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const draftRef = useRef({ title: initialTitle, contentMarkdown: initialContentMarkdown });
  const versionRef = useRef(initialVersion);

  const save = useCallback(
    (payload: { title: string; contentMarkdown: string }) =>
      apiRequest<SaveResponse>(`/api/lessons/${lessonId}`, {
        method: 'PATCH',
        body: { ...payload, version: versionRef.current },
      }),
    [lessonId],
  );

  const autosave = useAutosave<SaveResponse>(draftRef.current, {
    save,
    blocked: conflict,
    onSave: (response) => {
      versionRef.current = response.lesson.version;
      setVersion(response.lesson.version);
      setRevisions((previous) => [
        response.revision,
        ...previous.filter((revision) => revision.id !== response.revision.id),
      ]);
    },
    onConflict: () => {
      setConflict(true);
    },
  });

  const publishDraft = useCallback(() => {
    autosave.onEdit({ title: draftRef.current.title, contentMarkdown: draftRef.current.contentMarkdown });
  }, [autosave]);

  function onTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    draftRef.current = { ...draftRef.current, title: event.target.value };
    setTitle(event.target.value);
    publishDraft();
  }

  function onContentChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    draftRef.current = { ...draftRef.current, contentMarkdown: event.target.value };
    setContent(event.target.value);
    publishDraft();
  }

  /** Wraps or inserts Markdown around the textarea selection. */
  function applySyntax(prefix: string, suffix: string, placeholder: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    const selected = value.slice(selectionStart, selectionEnd) || placeholder;
    const next = `${value.slice(0, selectionStart)}${prefix}${selected}${suffix}${value.slice(selectionEnd)}`;
    draftRef.current = { ...draftRef.current, contentMarkdown: next };
    setContent(next);
    publishDraft();
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart + prefix.length, selectionStart + prefix.length + selected.length);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void autosave.saveNow();
      return;
    }
    if (meta && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applySyntax('**', '**', 'bold text');
      return;
    }
    if (meta && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      applySyntax('*', '*', 'italic text');
    }
  }

  async function onReload() {
    try {
      const lesson = await apiRequest<{
        title: string;
        contentMarkdown: string;
        version: number;
      }>(`/api/lessons/${lessonId}`);
      const history = await fetchRevisions(lessonId);
      versionRef.current = lesson.version;
      draftRef.current = { title: lesson.title, contentMarkdown: lesson.contentMarkdown };
      setVersion(lesson.version);
      setTitle(lesson.title);
      setContent(lesson.contentMarkdown);
      setRevisions(history.data);
      setConflict(false);
      autosave.reset();
    } catch (cause) {
      setLoadError(cause instanceof ApiError ? cause.message : 'The lesson could not be reloaded.');
    }
  }

  async function onRestored(response: {
    lesson: { title: string; contentMarkdown: string; version: number };
    revision: RevisionSummary;
  }) {
    versionRef.current = response.lesson.version;
    draftRef.current = {
      title: response.lesson.title,
      contentMarkdown: response.lesson.contentMarkdown,
    };
    setVersion(response.lesson.version);
    setTitle(response.lesson.title);
    setContent(response.lesson.contentMarkdown);
    setRevisions((previous) => [response.revision, ...previous]);
    autosave.reset();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {conflict ? <ConflictBanner onReload={() => void onReload()} /> : null}
      {loadError ? (
        <p role="alert" className="text-sm text-red-700">
          {loadError}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="lesson-title" className="text-sm font-medium text-foreground">
          Title
        </label>
        <input
          id="lesson-title"
          value={title}
          onChange={onTitleChange}
          maxLength={200}
          className="w-full rounded-md border border-input px-3 py-2 text-sm"
        />
      </div>

      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-2">
        <ToolbarButton label="Insert heading" shortcut="# " onClick={() => applySyntax('## ', '', 'Heading')}>
          H2
        </ToolbarButton>
        <ToolbarButton label="Insert bold" shortcut="Ctrl+B" onClick={() => applySyntax('**', '**', 'bold text')}>
          Bold
        </ToolbarButton>
        <ToolbarButton label="Insert italic" shortcut="Ctrl+I" onClick={() => applySyntax('*', '*', 'italic text')}>
          Italic
        </ToolbarButton>
        <ToolbarButton
          label="Insert bullet list"
          shortcut="- "
          onClick={() => applySyntax('-', '', 'list item')}
        >
          List
        </ToolbarButton>
        <ToolbarButton
          label="Insert quote"
          shortcut="> "
          onClick={() => applySyntax('> ', '', 'quote')}
        >
          Quote
        </ToolbarButton>
        <ToolbarButton
          label="Insert code"
          shortcut="``"
          onClick={() => applySyntax('`', '`', 'code')}
        >
          Code
        </ToolbarButton>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="lesson-content" className="text-sm font-medium text-foreground">
            Content
          </label>
          <textarea
            ref={textareaRef}
            id="lesson-content"
            value={content}
            onChange={onContentChange}
            onKeyDown={onKeyDown}
            spellCheck
            rows={24}
            className="h-[32rem] w-full resize-y rounded-md border border-input px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="space-y-1">
          <span id="preview-label" className="text-sm font-medium text-foreground">
            Preview
          </span>
          <div
            role="region"
            aria-labelledby="preview-label"
            className="h-[32rem] overflow-auto rounded-md border border-border bg-card px-4 py-3"
          >
            <MarkdownRenderer content={content} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {autosave.state.status === 'saving' && 'Saving…'}
          {autosave.state.status === 'saved' &&
            `Saved · v${version}${autosave.state.lastSavedAt ? ` · ${new Date(autosave.state.lastSavedAt).toLocaleTimeString()}` : ''}`}
          {autosave.state.status === 'dirty' && 'Unsaved changes'}
          {autosave.state.status === 'error' && 'Save failed — retrying…'}
          {autosave.state.status === 'conflict' && 'Conflict — reload to continue'}
          {autosave.state.status === 'idle' && `Unedited · v${version}`}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void autosave.saveNow()}
            disabled={conflict || autosave.state.status === 'saving'}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Save now
          </button>
        </div>
      </div>

      <RevisionHistory
        lessonId={lessonId}
        currentVersion={version}
        revisions={revisions}
        onRestored={(result) => void onRestored(result as never)}
      />
    </div>
  );
}

function ToolbarButton({
  children,
  label,
  shortcut,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${label}${shortcut ? ` (${shortcut})` : ''}`}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      className="rounded-md border border-input px-2.5 py-1 text-xs font-medium text-foreground hover:bg-background"
    >
      {children}
    </button>
  );
}
