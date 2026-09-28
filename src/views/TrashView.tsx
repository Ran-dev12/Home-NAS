import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { get, post } from '../lib/api.ts';
import { formatBytes, formatDateTime, plural, timeAgo } from '../lib/format.ts';
import type { TrashItem } from '../lib/types.ts';
import { Button, EmptyState, Notice, PageHeader, Spinner, useDialogs, useToast } from '../components/ui.tsx';
import { FileIcon } from '../components/files.tsx';

export function TrashView() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const dialogs = useDialogs();

  const load = useCallback(async () => {
    try {
      const r = await get<{ items: TrashItem[]; retentionDays: number }>('/api/trash');
      setItems(r.items);
      setDays(r.retentionDays);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const restore = async (it: TrashItem) => {
    setBusy(it.id);
    try {
      const r = await post<{ restored: { path: string }[] }>('/api/trash/restore', { ids: [it.id] });
      toast(`Restored to ${r.restored[0]?.path ?? it.path}`);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const purge = async (list: TrashItem[] | 'all') => {
    const n = list === 'all' ? (items?.length ?? 0) : list.length;
    const ok = await dialogs.confirm({
      title: list === 'all' ? 'Empty the trash?' : `Delete “${list[0].name}” forever?`,
      body: `${plural(n, 'item')} will be permanently deleted from the drive. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    try {
      await post('/api/trash/purge', list === 'all' ? { all: true } : { ids: list.map((x) => x.id) });
      toast('Permanently deleted');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const total = (items ?? []).reduce((s, x) => s + x.size, 0);

  return (
    <div>
      <PageHeader
        title="Trash"
        subtitle={days > 0 ? `Items are deleted forever ${days} days after they were moved here.` : 'Items stay here until you empty the trash.'}
        actions={
          items && items.length > 0 && (
            <Button variant="danger" icon={Trash2} onClick={() => purge('all')}>
              Empty trash
            </Button>
          )
        }
      />
      <div className="px-4 pb-8 md:px-8">
        {error && <Notice tone="danger">{error}</Notice>}
        {!items ? (
          <Spinner className="m-6" />
        ) : items.length === 0 ? (
          <EmptyState icon={Trash2} title="Trash is empty">
            Deleted files and folders wait here so you can change your mind.
          </EmptyState>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              {plural(items.length, 'item')} · {formatBytes(total)}
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line bg-card">
              {items.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <FileIcon kind={it.isDir ? 'folder' : 'other'} className="size-6 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.name}</p>
                    <p className="truncate text-xs text-muted" title={formatDateTime(it.deletedAt)}>
                      {it.spaceName} · {it.path.slice(0, it.path.lastIndexOf('/')) || '/'} · deleted {timeAgo(it.deletedAt)} · {formatBytes(it.size)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" icon={RotateCcw} loading={busy === it.id} onClick={() => restore(it)}>
                      Restore
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => purge([it])}>
                      Delete forever
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
