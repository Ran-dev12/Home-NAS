import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Images, Smartphone, Upload } from 'lucide-react';
import { get, urls } from '../lib/api.ts';
import { filesHref, navigate } from '../lib/router.ts';
import { monthKey, monthLabel, plural } from '../lib/format.ts';
import type { Photo, Space } from '../lib/types.ts';
import { useDebounced, useServerEvent } from '../lib/events.ts';
import { Button, EmptyState, Notice, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { Thumb } from '../components/files.tsx';
import { Lightbox } from '../components/Lightbox.tsx';

interface Page {
  items: Photo[];
  next: string | null;
}

export function PhotosView({ spaces }: { spaces: Space[] }) {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState<Photo[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const first = useCallback(async () => {
    try {
      const r = await get<Page>(`/api/photos?space=${encodeURIComponent(filter)}&limit=200`);
      setItems(r.items);
      setNext(r.next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    setItems(null);
    void first();
  }, [first]);

  const more = useCallback(async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await get<Page>(`/api/photos?space=${encodeURIComponent(filter)}&limit=200&cursor=${encodeURIComponent(next)}`);
      setItems((xs) => [...(xs ?? []), ...r.items]);
      setNext(r.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [next, loadingMore, filter]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && void more(), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more]);

  // New photos from a phone sync or an upload: refresh once the burst settles (only when at the top, to avoid jumps).
  const refresh = useDebounced(() => {
    if (window.scrollY < 200 && open === null) void first();
  }, 1500);
  useServerEvent('device', refresh);
  useServerEvent('fs', refresh);

  const groups = useMemo(() => {
    const out: { key: string; label: string; start: number; photos: Photo[] }[] = [];
    (items ?? []).forEach((p, i) => {
      const k = monthKey(p.ts);
      if (!out.length || out[out.length - 1].key !== k) out.push({ key: k, label: monthLabel(p.ts), start: i, photos: [] });
      out[out.length - 1].photos.push(p);
    });
    return out;
  }, [items]);

  return (
    <div>
      <PageHeader
        title="Photos"
        subtitle={items ? `${plural(items.length, 'item')}${next ? '+' : ''}, newest first` : undefined}
        actions={
          spaces.length > 1 && (
            <Select aria-label="Show photos from" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
              <option value="all">All folders</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )
        }
      />
      <div className="px-2 pb-8 md:px-8">
        {error && <Notice tone="danger">{error}</Notice>}
        {!items ? (
          <Spinner className="m-6" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Images}
            title="No photos yet"
            action={
              <>
                <Button variant="primary" icon={Smartphone} onClick={() => navigate('/phones')}>
                  Back up a phone
                </Button>
                <Button icon={Upload} onClick={() => navigate('/files')}>
                  Upload in Files
                </Button>
              </>
            }
          >
            Photos and videos from every folder you can access show up here, sorted by when they were taken. New ones can take a moment to appear while thumbnails are made.
          </EmptyState>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mb-6" aria-label={g.label}>
              <h2 className="sticky top-[49px] z-10 bg-bg/95 px-2 py-2 text-sm font-semibold backdrop-blur md:top-0">
                {g.label} <span className="font-normal text-muted">· {g.photos.length}</span>
              </h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
                {g.photos.map((p, i) => (
                  <li key={p.id}>
                    <button type="button" aria-label={`Open ${p.name}`} onClick={() => setOpen(g.start + i)} className="block w-full cursor-pointer overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-primary">
                      <Thumb entry={{ ...p, thumb: true }} className="aspect-square transition-opacity hover:opacity-90" iconClass="size-8" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <div ref={sentinel} />
        {loadingMore && <Spinner className="m-4" />}
      </div>

      {open !== null && items && (
        <Lightbox
          items={items.map((p) => ({ ...p, key: p.id }))}
          index={open}
          onIndex={(i) => {
            setOpen(i);
            if (i > items.length - 10) void more();
          }}
          onClose={() => setOpen(null)}
          srcFor={(p) => (p.kind === 'video' ? urls.file(p.id) : urls.preview(p.id))}
          downloadFor={(p) => urls.file(p.id, true)}
          infoFor={(p) => get(`/api/media/${p.id}`)}
          onShowInFolder={(p) => {
            setOpen(null);
            navigate(filesHref(p.space, p.path.slice(0, p.path.lastIndexOf('/')) || '/'));
          }}
        />
      )}
    </div>
  );
}
