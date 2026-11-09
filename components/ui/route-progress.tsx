'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Slim top progress bar for route transitions. It appears when an internal
 * link is clicked (or a client navigation is pushed) and settles when the new
 * segment renders — the pathname effect finishes the animation exactly once
 * the destination has landed, with a safety timeout for no-op navigations.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const start = () => setRunning(true);

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      const href = target.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        target.target === '_blank' ||
        target.hasAttribute('download')
      ) {
        return;
      }
      start();
    };

    const history = window.history;
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    const patchedPush: History['pushState'] = (data, unused, url) => {
      const result = originalPush(data, unused, url);
      start();
      return result;
    };
    const patchedReplace: History['replaceState'] = (data, unused, url) => {
      const result = originalReplace(data, unused, url);
      start();
      return result;
    };
    history.pushState = patchedPush;
    history.replaceState = patchedReplace;

    const onPopState = () => start();
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);

    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      history.pushState = originalPush;
      history.replaceState = originalReplace;
    };
  }, []);

  // The pathname settling means the destination segment rendered: finish.
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setRunning(false), 900);
    return () => clearTimeout(timer);
  }, [running, pathname]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-brand-50 transition-opacity duration-500 ${
        running ? 'opacity-100' : 'opacity-0'
      }`}
      role="presentation"
    >
      <div
        className="h-full w-1/3 rounded-full bg-brand-600"
        style={{
          animation: running ? 'route-progress-slide 1.1s ease-in-out infinite' : undefined,
        }}
      />
    </div>
  );
}
