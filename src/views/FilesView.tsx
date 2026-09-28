import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronRight,
  Download,
  Ellipsis,
  FolderInput,
  FolderPlus,
  FolderUp,
  Info,
  LayoutGrid,
  Link2,
  List,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { get, post, urls } from '../lib/api.ts';
import { filesHref, navigate, parseFilesPath, usePath } from '../lib/router.ts';
import { formatBytes, formatDate, plural } from '../lib/format.ts';
import type { Entry, Listing, Space, User } from '../lib/types.ts';
import { useDebounced, useServerEvent } from '../lib/events.ts';
import { Badge, Button, EmptyState, IconButton, Menu, Notice, Select, Spinner, cx, useDialogs, useToast, type MenuItem } from '../components/ui.tsx';
import { DetailsDialog, FileIcon, FilePreview, MoveDialog, ShareDialog, SpaceIcon, Thumb, canPreview } from '../components/files.tsx';
import { Lightbox } from '../components/Lightbox.tsx';
import { filesFromDrop, filesFromInput, useUploads } from '../components/uploads.tsx';

type SortKey = 'name' | 'mtime' | 'size';

interface SearchResult extends Entry {
  space: string;
  spaceName?: string;
}

function loadPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function FilesView({ spaces, user }: { spaces: Space[]; user: User; onSpacesChanged: () => void }) {
  const pathname = usePath();
  const { space: spaceId, path } = parseFilesPath(pathname);
  const space = spaces.find((s) => s.id === spaceId);
  const writable = space?.access === 'write';

  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'grid' | 'list'>(() => loadPref('hn.view', window.innerWidth < 768 ? 'grid' : 'list'));
  const [sort, setSort] = useState<SortKey>(() => loadPref('hn.sort', 'name'));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [preview, setPreview] = useState<Entry | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [shareTarget, setShareTarget] = useState<{ space: string; path: string; name: string } | null>(null);
  const [details, setDetails] = useState<{ space: string; path: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const crumbsRef = useRef<HTMLElement>(null);
  const uploads = useUploads();
  const toast = useToast();
  const dialogs = useDialogs();

  useEffect(() => {
    if (!space) navigate(filesHref(`u:${user.id}`, '/'), true);
  }, [space, user.id]);

  const load = useCallback(async () => {
    if (!space) return;
    try {
      setListing(await get<Listing>(urls.list(space.id, path)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setListing(null);
    }
  }, [space?.id, path]);

  useEffect(() => {
    setListing(null);
    setSelected(new Set());
    void load();
  }, [load]);

  // On a phone the path row scrolls sideways; keep the current folder in view.
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path, listing]);

  const reload = useDebounced(() => void load(), 500);
  useServerEvent<{ space: string }>('fs', (d) => d.space === space?.id && reload());
  useServerEvent('device', () => space?.kind === 'home' && reload());

  // Search across every space this user can see.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults(null);
    const t = setTimeout(() => {
      get<{ results: SearchResult[] }>(`/api/fs/search?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.results))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const entries = useMemo(() => {
    const list = [...(listing?.entries ?? [])];
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sort === 'mtime') return b.mtime - a.mtime;
      if (sort === 'size') return b.size - a.size || collator.compare(a.name, b.name);
      return collator.compare(a.name, b.name);
    });
    return list;
  }, [listing, sort]);

  const media = useMemo(() => entries.filter((e) => (e.kind === 'image' || e.kind === 'video') && e.id !== null), [entries]);
  const selectedEntries = entries.filter((e) => selected.has(e.path));
  const selecting = selected.size > 0;

  const toggle = (p: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  // ---- Actions -----------------------------------------------------------------------------------------

  const open = (e: Entry) => {
    if (!space) return;
    if (e.isDir) return navigate(filesHref(space.id, e.path));
    const mi = media.findIndex((m) => m.path === e.path);
    if (mi >= 0) return setLightbox(mi);
    if (canPreview(e)) return setPreview(e);
    window.location.href = urls.download(space.id, e.path);
  };

  const download = (list: Entry[]) => {
    if (!space || !list.length) return;
    if (list.length === 1) window.location.href = urls.download(space.id, list[0].path);
    else window.location.href = urls.zip(space.id, list.map((e) => e.path));
  };

  const newFolder = () =>
    space &&
    dialogs.prompt({
      title: 'New folder',
      label: 'Folder name',
      confirmLabel: 'Create',
      onSubmit: async (name) => {
        await post('/api/fs/mkdir', { space: space.id, path, name });
        await load();
      },
    });

  const rename = (e: Entry) =>
    space &&
    dialogs.prompt({
      title: `Rename ${e.isDir ? 'folder' : 'file'}`,
      label: 'New name',
      initial: e.name,
      selectStem: !e.isDir,
      confirmLabel: 'Rename',
      onSubmit: async (name) => {
        await post('/api/fs/rename', { space: space.id, path: e.path, name });
        setSelected(new Set());
        await load();
      },
    });

  const remove = async (list: Entry[]) => {
    if (!space || !list.length) return;
    const ok = await dialogs.confirm({
      title: list.length === 1 ? `Delete “${list[0].name}”?` : `Delete ${list.length} items?`,
      body: 'Deleted items go to the Trash, where you can restore them until they are cleared automatically.',
      confirmLabel: 'Move to Trash',
      danger: true,
    });
    if (!ok) return;
    try {
      await post('/api/fs/delete', { space: space.id, paths: list.map((e) => e.path) });
      toast(list.length === 1 ? 'Moved to Trash' : `${list.length} items moved to Trash`);
      setSelected(new Set());
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const itemMenu = (e: Entry): MenuItem[] => [
    { label: 'Open', icon: ChevronRight, onClick: () => open(e) },
    { label: e.isDir ? 'Download as zip' : 'Download', icon: Download, onClick: () => download([e]) },
    { label: 'Share link', icon: Link2, onClick: () => setShareTarget({ space: space!.id, path: e.path, name: e.name }), hidden: !writable },
    { label: 'Rename', icon: Pencil, onClick: () => rename(e), hidden: !writable },
    { label: writable ? 'Move or copy' : 'Copy to…', icon: FolderInput, onClick: () => setMoving([e.path]) },
    { label: 'Details', icon: Info, onClick: () => setDetails({ space: space!.id, path: e.path }) },
    { label: 'Delete', icon: Trash2, onClick: () => remove([e]), danger: true, hidden: !writable },
  ];

  // ---- Keyboard shortcuts ------------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, textarea, select, dialog, [role="dialog"]')) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') {
        ev.preventDefault();
        setSelected(new Set(entries.map((e) => e.path)));
      } else if (ev.key === 'Escape') setSelected(new Set());
      else if (ev.key === 'Delete' && writable && selectedEntries.length) void remove(selectedEntries);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!space) return <Spinner className="m-10" />;

  // ---- Drag and drop ----------------------------------------------------------------------------------

  const dropHandlers = writable
    ? {
        onDragEnter: (e: ReactDragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          dragDepth.current++;
          setDragging(true);
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        },
        onDragOver: (e: ReactDragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        },
        onDrop: async (e: ReactDragEvent) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const files = await filesFromDrop(e.dataTransfer);
          if (files.length) uploads.enqueue(space.id, path, files);
        },
      }
    : {};

  const crumbs = path.split('/').filter(Boolean);

  return (
    <div className="relative flex min-h-full flex-col" {...dropHandlers}>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (uploads.enqueue(space.id, path, filesFromInput(e.target.files)), (e.target.value = ''))} />
      <input
        ref={folderInput}
        type="file"
        hidden
        // @ts-expect-error non-standard but supported by every current browser
        webkitdirectory=""
        onChange={(e) => (uploads.enqueue(space.id, path, filesFromInput(e.target.files)), (e.target.value = ''))}
      />

      {/* Spaces + search */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-8 md:pt-6">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-subtle p-1" role="tablist" aria-label="Folders">
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === space.id}
              onClick={() => navigate(filesHref(s.id, '/'))}
              className={cx(
                'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                s.id === space.id ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              <SpaceIcon space={s} className="size-4" />
              {s.name}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all files"
            aria-label="Search all files"
            className="h-10 w-full rounded-lg border border-line bg-card pr-3 pl-9 text-base focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none sm:text-sm"
          />
        </div>
      </div>

      {results ? (
        <SearchResults results={results} query={query} onClose={() => setQuery('')} />
      ) : (
        <>
          {/* Breadcrumbs + toolbar */}
          <div className="sticky top-[49px] z-20 flex flex-wrap items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur md:top-0 md:px-8">
            {selecting ? (
              <>
                <IconButton label="Clear selection" icon={X} onClick={() => setSelected(new Set())} />
                <span className="text-sm font-medium">{selected.size} selected</span>
                <div className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" icon={Download} onClick={() => download(selectedEntries)}>
                    Download
                  </Button>
                  {selectedEntries.length === 1 && writable && (
                    <Button size="sm" icon={Pencil} onClick={() => rename(selectedEntries[0])}>
                      Rename
                    </Button>
                  )}
                  <Button size="sm" icon={FolderInput} onClick={() => setMoving(selectedEntries.map((e) => e.path))}>
                    {writable ? 'Move' : 'Copy'}
                  </Button>
                  {writable && (
                    <Button size="sm" variant="danger" icon={Trash2} onClick={() => remove(selectedEntries)}>
                      Delete
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <nav ref={crumbsRef} className="flex min-w-0 basis-full items-center gap-0.5 overflow-x-auto text-sm [scrollbar-width:none] sm:flex-1 sm:basis-auto" aria-label="Folder path">
                  <a
                    href={filesHref(space.id, '/')}
                    onClick={(e) => (e.preventDefault(), navigate(filesHref(space.id, '/')))}
                    className="shrink-0 rounded-md px-2 py-1 font-medium hover:bg-subtle"
                  >
                    {space.name}
                  </a>
                  {crumbs.map((c, i) => {
                    const href = filesHref(space.id, '/' + crumbs.slice(0, i + 1).join('/'));
                    return (
                      <span key={i} className="flex shrink-0 items-center gap-0.5">
                        <ChevronRight className="size-4 text-muted" aria-hidden />
                        <a
                          href={href}
                          onClick={(e) => (e.preventDefault(), navigate(href))}
                          aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                          className={cx('max-w-48 truncate rounded-md px-2 py-1 hover:bg-subtle', i === crumbs.length - 1 && 'font-medium')}
                        >
                          {c}
                        </a>
                      </span>
                    );
                  })}
                  {!writable && (
                    <span className="ml-2">
                      <Badge>Read only</Badge>
                    </span>
                  )}
                </nav>
                <div className="ml-auto flex items-center gap-1">
                  {writable && (
                    <>
                      <Button size="sm" variant="primary" icon={Upload} onClick={() => fileInput.current?.click()}>
                        Upload
                      </Button>
                      <IconButton label="Upload a folder" icon={FolderUp} onClick={() => folderInput.current?.click()} />
                      <IconButton label="New folder" icon={FolderPlus} onClick={newFolder} />
                    </>
                  )}
                  <label className="sr-only" htmlFor="sort">
                    Sort by
                  </label>
                  <div className="relative hidden sm:block">
                    <ArrowUpDown className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
                    <Select
                      id="sort"
                      value={sort}
                      onChange={(e) => (setSort(e.target.value as SortKey), savePref('hn.sort', e.target.value))}
                      className="h-8 w-auto pl-8 text-sm"
                    >
                      <option value="name">Name</option>
                      <option value="mtime">Newest</option>
                      <option value="size">Largest</option>
                    </Select>
                  </div>
                  <IconButton
                    label={view === 'grid' ? 'Show as list' : 'Show as grid'}
                    icon={view === 'grid' ? List : LayoutGrid}
                    onClick={() => {
                      const v = view === 'grid' ? 'list' : 'grid';
                      setView(v);
                      savePref('hn.view', v);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex-1 px-4 py-4 md:px-8">
            {error ? (
              <Notice tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>
                {error}
              </Notice>
            ) : !listing ? (
              <Spinner className="m-6" />
            ) : entries.length === 0 ? (
              <EmptyState
                icon={FolderUp}
                title="This folder is empty"
                action={
                  writable && (
                    <>
                      <Button variant="primary" icon={Upload} onClick={() => fileInput.current?.click()}>
                        Upload files
                      </Button>
                      <Button icon={FolderPlus} onClick={newFolder}>
                        New folder
                      </Button>
                    </>
                  )
                }
              >
                {writable ? 'Drag files or folders here, or use Upload.' : 'Nothing has been added here yet.'}
              </EmptyState>
            ) : view === 'grid' ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
                {entries.map((e) => (
                  <li key={e.path}>
                    <Tile entry={e} selected={selected.has(e.path)} selecting={selecting} onOpen={() => (selecting ? toggle(e.path) : open(e))} onToggle={() => toggle(e.path)} menu={itemMenu(e)} />
                  </li>
                ))}
              </ul>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="w-10 py-2">
                      <SelectBox
                        checked={selected.size === entries.length}
                        label="Select all"
                        onClick={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((e) => e.path)))}
                      />
                    </th>
                    <th className="py-2 font-medium">Name</th>
                    <th className="hidden w-36 py-2 font-medium md:table-cell">Modified</th>
                    <th className="hidden w-24 py-2 text-right font-medium sm:table-cell">Size</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr
                      key={e.path}
                      className={cx('group cursor-pointer border-b border-line transition-colors', selected.has(e.path) ? 'bg-primary-soft' : 'hover:bg-subtle')}
                      onClick={() => (selecting ? toggle(e.path) : open(e))}
                    >
                      <td className="py-1" onClick={(ev) => ev.stopPropagation()}>
                        <SelectBox checked={selected.has(e.path)} label={`Select ${e.name}`} onClick={() => toggle(e.path)} />
                      </td>
                      <td className="py-1.5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Thumb entry={e} className="size-10 shrink-0 rounded-lg" iconClass="size-6" />
                          <div className="min-w-0">
                            <p className="truncate font-medium" title={e.name}>
                              {e.name}
                            </p>
                            <p className="text-xs text-muted sm:hidden">
                              {e.isDir ? formatDate(e.mtime) : `${formatBytes(e.size)} · ${formatDate(e.mtime)}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden text-muted md:table-cell">{formatDate(e.takenAt ?? e.mtime)}</td>
                      <td className="hidden text-right text-muted tabular-nums sm:table-cell">{e.isDir ? '—' : formatBytes(e.size)}</td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <Menu label={`Actions for ${e.name}`} icon={Ellipsis} items={itemMenu(e)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {listing && entries.length > 0 && (
              <p className="mt-4 text-xs text-muted">
                {plural(entries.filter((e) => e.isDir).length, 'folder')}, {plural(entries.filter((e) => !e.isDir).length, 'file')} ·{' '}
                {formatBytes(entries.reduce((s, e) => s + e.size, 0))}
              </p>
            )}
          </div>
        </>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary-soft/80">
          <div className="text-center">
            <Upload className="mx-auto size-10 text-primary" aria-hidden />
            <p className="mt-2 font-semibold">Drop to upload to “{crumbs[crumbs.length - 1] ?? space.name}”</p>
            <p className="text-sm text-muted">Folders keep their structure</p>
          </div>
        </div>
      )}

      {lightbox !== null && (
        <Lightbox
          items={media.map((m) => ({ ...m, key: m.id!, kind: m.kind as 'image' | 'video' }))}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          srcFor={(m) => (m.kind === 'video' ? urls.file(m.id!) : urls.preview(m.id!))}
          downloadFor={(m) => urls.file(m.id!, true)}
          infoFor={(m) => get(`/api/media/${m.id}`)}
        />
      )}
      <FilePreview space={space.id} entry={preview} onClose={() => setPreview(null)} />
      <MoveDialog
        open={!!moving}
        spaces={spaces}
        fromSpace={space.id}
        fromPath={path}
        count={moving?.length ?? 0}
        onClose={() => setMoving(null)}
        onConfirm={async (toSpace, toPath, mode) => {
          const r = await post<{ paths: string[] }>('/api/fs/move', { space: space.id, paths: moving, toSpace, toPath, mode });
          toast(`${mode === 'move' ? 'Moved' : 'Copied'} ${plural(r.paths.length, 'item')}`);
          setSelected(new Set());
          await load();
        }}
      />
      <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)} />
      <DetailsDialog target={details} onClose={() => setDetails(null)} />
    </div>
  );
}

function SelectBox({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => (e.stopPropagation(), onClick())}
      className="flex size-10 cursor-pointer items-center justify-center"
    >
      <span className={cx('flex size-5 items-center justify-center rounded-md border-2 transition-colors', checked ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-card')}>
        {checked && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
      </span>
    </button>
  );
}

function Tile({
  entry,
  selected,
  selecting,
  onOpen,
  onToggle,
  menu,
}: {
  entry: Entry;
  selected: boolean;
  selecting: boolean;
  onOpen: () => void;
  onToggle: () => void;
  menu: MenuItem[];
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      className={cx(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-colors',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:border-primary/40',
      )}
    >
      <Thumb entry={entry} className="aspect-square" iconClass="size-14" />
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-medium" title={entry.name}>
          {entry.name}
        </p>
        <p className="truncate text-xs text-muted">{entry.isDir ? formatDate(entry.mtime) : `${formatBytes(entry.size)} · ${formatDate(entry.takenAt ?? entry.mtime)}`}</p>
      </div>
      <div className={cx('absolute top-1 left-1 transition-opacity', selecting || selected ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100')}>
        <SelectBox checked={selected} label={`Select ${entry.name}`} onClick={onToggle} />
      </div>
      <div
        className="absolute top-1 right-1 rounded-lg bg-card/90 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Menu label={`Actions for ${entry.name}`} icon={Ellipsis} items={menu} />
      </div>
    </div>
  );
}

function SearchResults({ results, query, onClose }: { results: SearchResult[]; query: string; onClose: () => void }) {
  return (
    <div className="px-4 py-4 md:px-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-sm text-muted">
          {results.length === 200 ? 'First 200 results' : plural(results.length, 'result')} for “{query.trim()}”
        </h2>
        <Button size="sm" icon={X} onClick={onClose}>
          Clear search
        </Button>
      </div>
      {results.length === 0 ? (
        <EmptyState icon={Search} title="Nothing found">
          Search looks at file and folder names in everything you can access.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-card">
          {results.map((r) => {
            const folder = r.isDir ? r.path : r.path.slice(0, r.path.lastIndexOf('/')) || '/';
            return (
              <li key={r.space + r.path}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-subtle"
                  onClick={() => {
                    onClose();
                    navigate(filesHref(r.space, folder));
                  }}
                >
                  <FileIcon kind={r.kind} className="size-6 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="truncate text-xs text-muted">
                      {r.spaceName} · {folder}
                    </p>
                  </div>
                  {!r.isDir && <span className="text-xs text-muted">{formatBytes(r.size)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
