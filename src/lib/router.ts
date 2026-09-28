import { useSyncExternalStore } from 'react';

const NAV_EVENT = 'homenas:navigate';

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}

/** Current pathname; re-renders on back/forward and on navigate(). */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(to: string, replace = false) {
  if (to === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** /files/<space>/<a>/<b> <-> { space, path } */
export function filesHref(space: string, path: string): string {
  const segs = path.split('/').filter(Boolean).map(encodeURIComponent);
  return `/files/${encodeURIComponent(space)}${segs.length ? '/' + segs.join('/') : ''}`;
}

export function parseFilesPath(pathname: string): { space: string | null; path: string } {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'files' || !parts[1]) return { space: null, path: '/' };
  return {
    space: decodeURIComponent(parts[1]),
    path: '/' + parts.slice(2).map((p) => decodeURIComponent(p)).join('/'),
  };
}
