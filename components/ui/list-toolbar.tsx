'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

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
 * Search bar with status and sort selects for the server-rendered list pages.
 * State lives in the URL: changes push a GET navigation so the page
 * re-renders server-side with the new query (shareable, no duplicated state).
 * The search input is debounced; selects navigate immediately.
 */
export function ListToolbar(props: ListToolbarProps) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchText, setSearchText] = useState(props.search.value);
  const [statusValue, setStatusValue] = useState(props.status.value);
  const [sortValue, setSortValue] = useState(props.sort.value);
  const propKey = `${props.search.value}|${props.status.value}|${props.sort.value}`;
  const lastPropKey = useRef(propKey);

  // Server round-trips (pagination links, back/forward, Clear via URL)
  // re-render with new props; resync local state so inputs mirror the URL.
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

  const inputClass =
    'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground';
  const selectClass = 'rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground';

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" data-testid="list-toolbar">
      <div className="min-w-56 flex-1 space-y-1">
        <label htmlFor={props.search.testid} className="text-foreground text-sm font-medium">
          {props.search.label}
        </label>
        <input
          id={props.search.testid}
          name={props.search.name}
          type="search"
          value={searchText}
          placeholder={props.search.placeholder}
          onChange={onSearchChange}
          className={inputClass}
          data-testid={props.search.testid}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor={props.status.testid} className="text-foreground text-sm font-medium">
          {props.status.label}
        </label>
        <select
          id={props.status.testid}
          name={props.status.name}
          value={statusValue}
          onChange={(event) => {
            const next = event.target.value;
            setStatusValue(next);
            clearTimer();
            navigate(searchText.trim(), next, sortValue);
          }}
          className={selectClass}
          data-testid={props.status.testid}
        >
          {props.status.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor={props.sort.testid} className="text-foreground text-sm font-medium">
          {props.sort.label}
        </label>
        <select
          id={props.sort.testid}
          name={props.sort.name}
          value={sortValue}
          onChange={(event) => {
            const next = event.target.value;
            setSortValue(next);
            clearTimer();
            navigate(searchText.trim(), statusValue, next);
          }}
          className={selectClass}
          data-testid={props.sort.testid}
        >
          {props.sort.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" size="sm">
        Apply
      </Button>
      {props.hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          data-testid="list-toolbar-clear"
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}
