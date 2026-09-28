import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  House,
  Lock,
  MapPin,
  Play,
  Users,
} from 'lucide-react';
import { get, post, urls } from '../lib/api.ts';
import { formatBytes, formatDateTime, formatDuration, plural } from '../lib/format.ts';
import type { Entry, ShareLink, Space } from '../lib/types.ts';
import { Button, CopyField, Field, Input, Modal, Notice, Select, Spinner, cx } from './ui.tsx';

const KIND_ICON = {
  folder: Folder,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  text: FileCode,
  archive: FileArchive,
  other: File,
} as const;

export function FileIcon({ kind, className }: { kind: Entry['kind']; className?: string }) {
  const Icon = KIND_ICON[kind] ?? File;
  return <Icon className={cx(kind === 'folder' ? 'fill-folder/20 text-folder' : 'text-file', className)} aria-hidden />;
}

export function SpaceIcon({ space, className }: { space: Pick<Space, 'kind'>; className?: string }) {
  const Icon = space.kind === 'home' ? House : Users;
  return <Icon className={className} aria-hidden />;
}

/** Thumbnail with graceful fallback to an icon (unsupported format, video without ffmpeg, still processing). */
export function Thumb({ entry, className, iconClass = 'size-10' }: { entry: Pick<Entry, 'id' | 'kind' | 'thumb' | 'mtime' | 'duration' | 'name'>; className?: string; iconClass?: string }) {
  const [failed, setFailed] = useState(false);
  const show = entry.thumb && entry.id && !failed;
  return (
    <div className={cx('relative flex items-center justify-center overflow-hidden bg-subtle', className)}>
      {show ? (
        <img src={urls.thumb(entry.id!, entry.mtime)} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <FileIcon kind={entry.kind} className={iconClass} />
      )}
      {entry.kind === 'video' && show && (
        <span className="absolute right-1 bottom-1 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          <Play className="size-3 fill-white" aria-hidden />
          {formatDuration(entry.duration)}
        </span>
      )}
    </div>
  );
}

// ---- Preview for documents, text and audio (images and video use the Lightbox) ------------------------

export function canPreview(e: Entry): boolean {
  const ext = e.name.split('.').pop()?.toLowerCase() ?? '';
  return e.kind === 'audio' || e.kind === 'text' || ext === 'pdf';
}

export function FilePreview({ space, entry, onClose }: { space: string; entry: Entry | null; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const isPdf = !!entry && entry.name.toLowerCase().endsWith('.pdf');
  useEffect(() => {
    setText(null);
    if (!entry || entry.kind !== 'text') return;
    const ctrl = new AbortController();
    fetch(urls.inline(space, entry.path), { signal: ctrl.signal })
      .then((r) => r.text())
      .then((t) => setText(t.length > 500_000 ? t.slice(0, 500_000) + '\n\n… (truncated — download to see the whole file)' : t))
      .catch(() => {});
    return () => ctrl.abort();
  }, [space, entry]);
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      title={entry?.name}
      size="lg"
      footer={
        entry && (
          <a href={urls.download(space, entry.path)} className="inline-flex h-10 items-center rounded-lg bg-primary-solid px-4 text-sm font-medium text-primary-fg hover:bg-primary-solid-hover">
            Download
          </a>
        )
      }
    >
      {entry && isPdf && <iframe src={urls.inline(space, entry.path)} title={entry.name} className="h-[70dvh] w-full rounded-lg border border-line" />}
      {entry?.kind === 'audio' && <audio controls autoPlay src={urls.inline(space, entry.path)} className="w-full" />}
      {entry?.kind === 'text' &&
        (text === null ? <Spinner /> : <pre className="max-h-[65dvh] overflow-auto rounded-lg bg-subtle p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>)}
    </Modal>
  );
}

// ---- Move / copy: pick a destination folder ------------------------------------------------------------

export function MoveDialog({
  open,
  spaces,
  fromSpace,
  fromPath,
  count,
  onClose,
  onConfirm,
}: {
  open: boolean;
  spaces: Space[];
  fromSpace: string;
  fromPath: string;
  count: number;
  onClose: () => void;
  onConfirm: (space: string, path: string, mode: 'move' | 'copy') => Promise<void>;
}) {
  const writable = spaces.filter((s) => s.access === 'write');
  const [space, setSpace] = useState(fromSpace);
  const [path, setPath] = useState(fromPath);
  const [dirs, setDirs] = useState<Entry[] | null>(null);
  const [mode, setMode] = useState<'move' | 'copy'>('move');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canMove = spaces.find((s) => s.id === fromSpace)?.access === 'write';

  useEffect(() => {
    if (!open) return;
    setSpace(writable.some((s) => s.id === fromSpace) ? fromSpace : (writable[0]?.id ?? fromSpace));
    setPath(fromPath);
    setMode(canMove ? 'move' : 'copy');
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDirs(null);
    get<{ entries: Entry[] }>(urls.list(space, path))
      .then((r) => setDirs(r.entries.filter((e) => e.isDir).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))))
      .catch((e) => setError(e.message));
  }, [open, space, path]);

  const crumbs = path.split('/').filter(Boolean);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(space, path, mode);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${mode === 'move' ? 'Move' : 'Copy'} ${plural(count, 'item')}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={confirm} disabled={mode === 'move' && space === fromSpace && path === fromPath}>
            {mode === 'move' ? 'Move here' : 'Copy here'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Action" id="mv-mode">
            <Select id="mv-mode" value={mode} onChange={(e) => setMode(e.target.value as 'move' | 'copy')}>
              {canMove && <option value="move">Move</option>}
              <option value="copy">Copy</option>
            </Select>
          </Field>
          <Field label="To" id="mv-space">
            <Select
              id="mv-space"
              value={space}
              onChange={(e) => {
                setSpace(e.target.value);
                setPath('/');
              }}
            >
              {writable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Destination folder">
          <button type="button" className="cursor-pointer rounded px-1.5 py-1 font-medium hover:bg-subtle" onClick={() => setPath('/')}>
            {writable.find((s) => s.id === space)?.name ?? 'Top'}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted" aria-hidden />
              <button type="button" className="cursor-pointer rounded px-1.5 py-1 hover:bg-subtle" onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </button>
            </span>
          ))}
        </nav>
        <div className="h-64 overflow-y-auto rounded-xl border border-line">
          {!dirs ? (
            <Spinner className="m-4" />
          ) : dirs.length === 0 ? (
            <p className="p-4 text-sm text-muted">No folders inside. Items will go directly here.</p>
          ) : (
            dirs.map((d) => (
              <button
                key={d.path}
                type="button"
                onClick={() => setPath(d.path)}
                className="flex w-full cursor-pointer items-center gap-3 border-b border-line px-3 py-2.5 text-left text-sm last:border-0 hover:bg-subtle"
              >
                <FileIcon kind="folder" className="size-5" />
                <span className="flex-1 truncate">{d.name}</span>
                <ChevronRight className="size-4 text-muted" aria-hidden />
              </button>
            ))
          )}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

// ---- Share link ---------------------------------------------------------------------------------------

export function ShareDialog({ target, onClose }: { target: { space: string; path: string; name: string } | null; onClose: () => void }) {
  const [expires, setExpires] = useState('7');
  const [password, setPassword] = useState('');
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (target) {
      setLink(null);
      setPassword('');
      setExpires('7');
      setError(null);
    }
  }, [target]);
  const create = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ link: ShareLink }>('/api/shares', {
        space: target.space,
        path: target.path,
        expiresDays: expires === 'never' ? null : Number(expires),
        password: password || undefined,
      });
      setLink(r.link);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={`Share “${target?.name ?? ''}”`}
      footer={
        link ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={create}>
              Create link
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="flex flex-col gap-4">
          <CopyField label="Link" value={link.url} />
          <p className="text-sm text-muted">
            {link.expiresAt ? `Works until ${formatDateTime(link.expiresAt)}.` : 'Works until you turn it off in Shared links.'}
            {link.hasPassword && ' Anyone opening it needs the password.'}
          </p>
          <Notice tone="info">
            The link works for people on your home network, or connected to it through a VPN such as Tailscale. It will not open over the open internet.
          </Notice>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <p className="text-sm text-muted">Anyone with the link can view and download this without an account.</p>
          <Field label="Link stops working" id="sh-exp">
            <Select id="sh-exp" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="1">After 1 day</option>
              <option value="7">After 7 days</option>
              <option value="30">After 30 days</option>
              <option value="never">Never</option>
            </Select>
          </Field>
          <Field label="Password (optional)" id="sh-pw" hint="Leave empty for no password." error={error}>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input id="sh-pw" type="text" autoComplete="off" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </Field>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

// ---- Details ------------------------------------------------------------------------------------------

interface Info extends Entry {
  camera: string | null;
  lat: number | null;
  lon: number | null;
  sha256: string | null;
  contents: { files: number; folders: number; bytes: number } | null;
}

export function DetailsDialog({ target, onClose }: { target: { space: string; path: string } | null; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    setError(null);
    if (!target) return;
    get<Info>(`/api/fs/info?space=${encodeURIComponent(target.space)}&path=${encodeURIComponent(target.path)}`)
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [target]);
  const rows: [string, ReactNode][] = info
    ? [
        ['Location', <span className="font-mono text-xs break-all">{info.path}</span>],
        info.isDir && info.contents
          ? ['Contains', `${plural(info.contents.files, 'file')}, ${plural(info.contents.folders, 'folder')} · ${formatBytes(info.contents.bytes)}`]
          : ['Size', `${formatBytes(info.size)} (${info.size.toLocaleString()} bytes)`],
        ['Modified', formatDateTime(info.mtime)],
        ...(info.takenAt ? [['Taken', formatDateTime(info.takenAt)] as [string, string]] : []),
        ...(info.width && info.height ? [['Dimensions', `${info.width} × ${info.height}`] as [string, string]] : []),
        ...(info.duration ? [['Length', formatDuration(info.duration)] as [string, string]] : []),
        ...(info.camera ? [['Camera', info.camera] as [string, string]] : []),
        ...(info.lat !== null && info.lon !== null
          ? [
              [
                'Location',
                <a
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  href={`https://www.openstreetmap.org/?mlat=${info.lat}&mlon=${info.lon}#map=15/${info.lat}/${info.lon}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <MapPin className="size-4" aria-hidden />
                  {info.lat.toFixed(4)}, {info.lon.toFixed(4)}
                </a>,
              ] as [string, ReactNode],
            ]
          : []),
      ]
    : [];
  return (
    <Modal open={!!target} onClose={onClose} title={info?.name ?? 'Details'} size="sm">
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : !info ? (
        <Spinner />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
          {rows.map(([k, v], i) => (
            <div key={i} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}
