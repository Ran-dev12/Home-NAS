import { useEffect, useRef } from 'react';
import { STATE_EVENT } from './api.ts';

const PREFIX = 'homenas:sse:';

/** One EventSource for the whole app; each server event is re-broadcast as a window event. */
export function useServerEventStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/events');
    const forward = (type: string) => (ev: MessageEvent) => {
      let data: unknown = null;
      try {
        data = JSON.parse(ev.data);
      } catch {
        /* ignore */
      }
      if (type === 'state') window.dispatchEvent(new Event(STATE_EVENT));
      window.dispatchEvent(new CustomEvent(PREFIX + type, { detail: data }));
    };
    for (const t of ['fs', 'activity', 'device', 'index', 'state']) es.addEventListener(t, forward(t) as EventListener);
    return () => es.close();
  }, [enabled]);
}

/** Subscribe to one kind of server event. The latest handler is always used without re-subscribing. */
export function useServerEvent<T = unknown>(type: string, handler: (data: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<T>).detail);
    window.addEventListener(PREFIX + type, on);
    return () => window.removeEventListener(PREFIX + type, on);
  }, [type]);
}

/** Collapse bursts (a 300-photo phone sync) into one refresh. */
export function useDebounced(fn: () => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(), ms);
  };
}
