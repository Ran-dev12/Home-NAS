import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Download, Lock, Server } from 'lucide-react';
import { ApiError, get, post } from '../lib/api.ts';
import { formatBytes, formatDate } from '../lib/format.ts';
import type { Entry } from '../lib/types.ts';
import { Button, Card, Field, Input, Notice, Spinner, cx } from '../components/ui.tsx';
import { FileIcon } from '../components/files.tsx';
import { Lightbox } from '../components/Lightbox.tsx';

interface ShareMeta {
  name: string;
  isDir: boolean;
  expiresAt: string | null;
  serverName: string;
  needsPassword: boolean;
  path?: string;
  entries?: Entry[];
  file?: Entry;
}

/** What someone without an account sees when they open a share link. */
export function SharePage({ token }: { token: string }) {
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [path, setPath] = useState('/');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const base = `/api/public/share/${encodeURIComponent(token)}`;
  const q = (p: string) => `?path=${encodeURIComponent(p)}`;

  const load = useCallback(async () => {
    try {
      const m = await get<ShareMeta>(`${base}${q(path)}`);
      setMeta(m);
      document.title = `${m.name} · ${m.serverName}`;
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'This link could not be opened');
    }
  }, [base, path]);
  useEffect(() => void load(), [load]);

  const unlock = async () => {
    setPwError(null);
    try {
      await post(`${base}/unlock`, { password });
      await load();
    } catch (e) {
      setPwError((e as Error).message);
    }
  };

  const media = (meta?.entries ?? []).filter((e) => e.kind === 'image' || e.kind === 'video');
  const crumbs = path.split('/').filter(Boolean);

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary-solid text-primary-fg">
          <Server className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{meta?.name ?? 'Shared with you'}</h1>
          <p className="text-sm text-muted">
            Shared from {meta?.serverName ?? 'HomeNAS'}
            {meta?.expiresAt && ` · available until ${formatDate(meta.expiresAt)}`}
          </p>
        </div>
        {meta && !meta.needsPassword && (
          <a href={`${base}/file${q(path)}&dl=1`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-solid px-4 text-sm font-medium text-primary-fg hover:bg-primary-solid-hover">
            <Download className="size-4" aria-hidden />
            {meta.isDir ? 'Download all' : 'Download'}
          </a>
        )}
      </header>

      {error ? (
        <Notice tone="danger" title="Link unavailable">
          {error}
        </Notice>
      ) : !meta ? (
        <Spinner />
      ) : meta.needsPassword ? (
        <Card className="mx-auto max-w-sm p-5">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <p className="flex items-center gap-2 text-sm text-muted">
              <Lock className="size-4" aria-hidden /> This link is protected with a password.
            </p>
            <Field label="Password" id="share-pw" error={pwError}>
              <Input id="share-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            <Button type="submit" variant="primary" disabled={!password}>
              Open
            </Button>
          </form>
        </Card>
      ) : meta.file ? (
        <Card className="flex flex-col items-center gap-4 p-6 text-center">
          {meta.file.kind === 'image' ? (
            <img src={`${base}/preview`} alt={meta.name} className="max-h-[70dvh] max-w-full rounded-lg object-contain" />
          ) : meta.file.kind === 'video' ? (
            <video src={`${base}/file`} controls playsInline className="max-h-[70dvh] max-w-full rounded-lg" />
          ) : (
            <FileIcon kind={meta.file.kind} className="size-16" />
          )}
          <p className="text-sm text-muted">
            {meta.name} · {formatBytes(meta.file.size)}
          </p>
        </Card>
      ) : (
        <>
          {crumbs.length > 0 && (
            <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm" aria-label="Folder path">
              <button type="button" className="cursor-pointer rounded px-2 py-1 font-medium hover:bg-subtle" onClick={() => setPath('/')}>
                {meta.name}
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                  <button type="button" className="cursor-pointer rounded px-2 py-1 hover:bg-subtle" onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>
                    {c}
                  </button>
                </span>
              ))}
            </nav>
          )}
          {!meta.entries?.length ? (
            <p className="text-sm text-muted">This folder is empty.</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {meta.entries.map((e) => {
                const mi = media.findIndex((m) => m.path === e.path);
                return (
                  <li key={e.path}>
                    <button
                      type="button"
                      onClick={() => (e.isDir ? setPath(e.path) : mi >= 0 ? setLightbox(mi) : (window.location.href = `${base}/file${q(e.path)}&dl=1`))}
                      className="flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-card text-left hover:border-primary/40"
                    >
                      <div className={cx('flex aspect-square items-center justify-center overflow-hidden bg-subtle')}>
                        {e.thumb ? (
                          <img src={`${base}/thumb${q(e.path)}`} alt="" loading="lazy" className="size-full object-cover" onError={(ev) => (ev.currentTarget.style.display = 'none')} />
                        ) : (
                          <FileIcon kind={e.kind} className="size-12" />
                        )}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="truncate text-sm font-medium">{e.name}</p>
                        <p className="text-xs text-muted">{e.isDir ? 'Folder' : formatBytes(e.size)}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {lightbox !== null && (
        <Lightbox
          items={media.map((m) => ({ ...m, key: m.path, kind: m.kind as 'image' | 'video' }))}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          srcFor={(m) => (m.kind === 'video' ? `${base}/file${q(m.path)}` : `${base}/preview${q(m.path)}`)}
          downloadFor={(m) => `${base}/file${q(m.path)}&dl=1`}
        />
      )}
    </div>
  );
}
