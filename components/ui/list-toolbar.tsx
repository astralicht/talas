'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface ToolbarOption {
  value: string;
  label: string;
}

interface ToolbarSelect {
  name: string;
  value: string;
  defaultValue: string;
  label: string;
  options: ToolbarOption[];
  testid: string;
}

export interface ListToolbarProps {
  /** Path the form navigates to (e.g. /materials). */
  action: string;
  search: { name: string; value: string; label: string; placeholder: string; testid: string };
  status: ToolbarSelect;
  sort: ToolbarSelect;
  /** Whether any non-default filter is active (controls the Clear button). */
  hasFilters: boolean;
}

/**
 * The shared filter bar for every server-rendered list page (materials,
 * lessons, quizzes): a rounded pill search input, status tab pills, and sort
 * links — the same design on all screens. State lives in the URL: the search
 * is debounced; pills and sort links navigate immediately. Server
 * round-trips (pagination, back/forward, Clear via URL) resync local state.
 */
export function ListToolbar(props: ListToolbarProps) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchText, setSearchText] = useState(props.search.value);
  const [statusValue, setStatusValue] = useState(props.status.value);
  const [sortValue, setSortValue] = useState(props.sort.value);
  const propKey = `${props.search.value}|${props.status.value}|${props.sort.value}`;
  const lastPropKey = useRef(propKey);

  useEffect(() => {
    if (lastPropKey.current === propKey) return;
    lastPropKey.current = propKey;
    setSearchText(props.search.value);
    setStatusValue(props.status.value);
    setSortValue(props.sort.value);
  }, [propKey, props.search.value, props.status.value, props.sort.value]);

  function navigate(nextSearch: string, nextStatus: string, nextSort: string) {
    const params = new URLSearchParams();
    if (nextSearch) params.set('q', nextSearch);
    if (nextStatus && nextStatus !== props.status.defaultValue) params.set('status', nextStatus);
    if (nextSort && nextSort !== props.sort.defaultValue) params.set('sort', nextSort);
    const query = params.toString();
    router.push(query ? `${props.action}?${query}` : props.action);
  }

  function clearTimer() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setSearchText(next);
    clearTimer();
    debounceRef.current = setTimeout(() => {
      navigate(next.trim(), statusValue, sortValue);
    }, 350);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearTimer();
    navigate(searchText.trim(), statusValue, sortValue);
  }

  function onClear() {
    clearTimer();
    setSearchText('');
    setStatusValue(props.status.defaultValue);
    setSortValue(props.sort.defaultValue);
    router.push(props.action);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="list-toolbar">
      <input
        id={props.search.testid}
        name={props.search.name}
        type="search"
        value={searchText}
        placeholder={props.search.placeholder}
        aria-label={props.search.label}
        onChange={onSearchChange}
        className="border-input bg-card w-full max-w-sm rounded-full border px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        data-testid={props.search.testid}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={props.status.label}
          data-testid={props.status.testid}
        >
          {props.status.options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={statusValue === option.value}
              onClick={() => {
                setStatusValue(option.value);
                clearTimer();
                navigate(searchText.trim(), option.value, sortValue);
              }}
              className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                statusValue === option.value
                  ? 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="text-muted-foreground mx-1" aria-hidden="true">
          ·
        </span>

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={props.sort.label}
          data-testid={props.sort.testid}
        >
          {props.sort.options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={sortValue === option.value}
              onClick={() => {
                setSortValue(option.value);
                clearTimer();
                navigate(searchText.trim(), statusValue, option.value);
              }}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                sortValue === option.value
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {props.hasFilters ? (
          <button
            type="button"
            onClick={onClear}
            data-testid="list-toolbar-clear"
            className="text-muted-foreground hover:text-foreground ml-1 text-sm underline-offset-2 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
