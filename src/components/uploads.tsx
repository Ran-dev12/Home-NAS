import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, RotateCcw, Upload, X } from 'lucide-react';
import { uploadFile, type UploadHandle } from '../lib/api.ts';
import { formatBytes } from '../lib/format.ts';
import { IconButton, ProgressBar, cx } from './ui.tsx';

export interface PendingFile {
  file: File;
  /** Sub-folder inside the target, for folder uploads ("Holiday/Day 1"). */
  relpath: string;
}

interface Item {
  id: number;
  file: File;
  relpath: string;
  space: string;
  dir: string;
  conflict: 'rename' | 'overwrite' | 'skip';
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  loaded: number;
  error?: string;
}

interface UploadApi {
  enqueue: (space: string, dir: string, files: PendingFile[], conflict?: Item['conflict']) => void;
}

const Ctx = createContext<UploadApi>({ enqueue: () => {} });
export const useUploads = () => useContext(Ctx);

const CONCURRENCY = 3;

/** Uploads keep going while you browse elsewhere in the app. */
export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const handles = useRef(new Map<number, UploadHandle>());
  const nextId = useRef(1);

  const update = (id: number, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const enqueue = useCallback<UploadApi['enqueue']>((space, dir, files, conflict = 'rename') => {
    setCollapsed(false);
    setItems((xs) => [
      ...xs.filter((x) => x.status !== 'done'),
      ...files.map((f) => ({ id: nextId.current++, file: f.file, relpath: f.relpath, space, dir, conflict, status: 'queued' as const, loaded: 0 })),
    ]);
  }, []);

  useEffect(() => {
    const running = items.filter((x) => x.status === 'uploading').length;
    const waiting = items.filter((x) => x.status === 'queued').slice(0, CONCURRENCY - running);
    for (const it of waiting) {
      update(it.id, { status: 'uploading' });
      const h = uploadFile(it.space, it.dir, it.file, it.relpath, it.conflict, (loaded) => update(it.id, { loaded }));
      handles.current.set(it.id, h);
      h.promise
        .then(() => update(it.id, { status: 'done', loaded: it.file.size }))
        .catch((e: Error & { code?: string }) => update(it.id, { status: e.code === 'aborted' ? 'cancelled' : 'error', error: e.message }))
        .finally(() => handles.current.delete(it.id));
    }
  }, [items]);

  // Warn before closing the tab mid-upload.
  const busy = items.some((x) => x.status === 'uploading' || x.status === 'queued');
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [busy]);

  const total = items.reduce((s, x) => s + x.file.size, 0);
  const loaded = items.reduce((s, x) => s + (x.status === 'done' ? x.file.size : x.loaded), 0);
  const done = items.filter((x) => x.status === 'done').length;
  const failed = items.filter((x) => x.status === 'error').length;

  return (
    <Ctx.Provider value={{ enqueue }}>
      {children}
      {items.length > 0 && (
        <div className="fixed right-3 bottom-20 z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-card shadow-2xl md:right-6 md:bottom-6">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <Upload className="size-4 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {busy ? `Uploading ${done + 1 > items.length ? items.length : done + 1} of ${items.length}` : failed ? `${failed} upload${failed === 1 ? '' : 's'} failed` : `${done} uploaded`}
              </p>
              <p className="text-xs text-muted">
                {formatBytes(loaded)} of {formatBytes(total)}
              </p>
            </div>
            <IconButton label={collapsed ? 'Show uploads' : 'Hide uploads'} icon={ChevronDown} className={cx(collapsed && 'rotate-180')} onClick={() => setCollapsed(!collapsed)} />
            {!busy && <IconButton label="Close" icon={X} onClick={() => setItems([])} />}
          </div>
          {busy && (
            <div className="px-4 pt-2">
              <ProgressBar value={total ? (loaded / total) * 100 : 0} label="Total upload progress" />
            </div>
          )}
          {!collapsed && (
            <ul className="max-h-64 overflow-y-auto py-1">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate" title={it.relpath ? `${it.relpath}/${it.file.name}` : it.file.name}>
                      {it.file.name}
                    </p>
                    {it.status === 'uploading' && <ProgressBar value={(it.loaded / Math.max(1, it.file.size)) * 100} label={`Uploading ${it.file.name}`} />}
                    {it.status === 'error' && <p className="text-xs text-danger">{it.error}</p>}
                    {it.status === 'queued' && <p className="text-xs text-muted">Waiting · {formatBytes(it.file.size)}</p>}
                  </div>
                  {it.status === 'done' && <CircleCheck className="size-5 text-ok" aria-label="Uploaded" />}
                  {it.status === 'error' && (
                    <>
                      <CircleAlert className="size-5 text-danger" aria-hidden />
                      <IconButton label="Retry" icon={RotateCcw} onClick={() => update(it.id, { status: 'queued', loaded: 0, error: undefined })} />
                    </>
                  )}
                  {(it.status === 'uploading' || it.status === 'queued') && (
                    <IconButton
                      label="Cancel upload"
                      icon={X}
                      onClick={() => {
                        const h = handles.current.get(it.id);
                        if (h) h.abort();
                        else update(it.id, { status: 'cancelled' });
                      }}
                    />
                  )}
                  {it.status === 'cancelled' && <span className="text-xs text-muted">Cancelled</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Walk a drag-and-drop payload, including dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<PendingFile[]> {
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files].map((file) => ({ file, relpath: '' }));
  const out: PendingFile[] = [];
  const walk = async (entry: FileSystemEntry, rel: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, relpath: rel });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const sub = rel ? `${rel}/${entry.name}` : entry.name;
      // readEntries returns at most ~100 at a time; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, sub);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export function filesFromInput(list: FileList | null): PendingFile[] {
  return [...(list ?? [])].map((file) => {
    const rel = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(0, -1).join('/') : '';
    return { file, relpath: rel };
  });
}
