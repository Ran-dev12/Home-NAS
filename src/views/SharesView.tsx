import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Lock } from 'lucide-react';
import { del, get } from '../lib/api.ts';
import { formatDate, plural } from '../lib/format.ts';
import type { ShareLink } from '../lib/types.ts';
import { Badge, Button, CopyButton, EmptyState, Notice, PageHeader, Spinner, useDialogs, useToast } from '../components/ui.tsx';
import { FileIcon } from '../components/files.tsx';

export function SharesView() {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const dialogs = useDialogs();

  const load = useCallback(async () => {
    try {
      setLinks((await get<{ links: ShareLink[] }>('/api/shares')).links);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const revoke = async (l: ShareLink) => {
    const ok = await dialogs.confirm({
      title: 'Turn off this link?',
      body: `Anyone who has the link to “${l.name}” will no longer be able to open it. The files themselves are not touched.`,
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (!ok) return;
    await del(`/api/shares/${l.id}`);
    toast('Link turned off');
    void load();
  };

  return (
    <div>
      <PageHeader title="Shared links" subtitle="Links you made so people without an account can view or download files." />
      <div className="flex flex-col gap-3 px-4 pb-8 md:px-8">
        <Notice tone="info">Links work on your home network (or over a VPN such as Tailscale). To share something, open Files, choose a file or folder, then Share link.</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
        {!links ? (
          <Spinner className="m-6" />
        ) : links.length === 0 ? (
          <EmptyState icon={Link2} title="No shared links" />
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-card">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <FileIcon kind={l.isDir ? 'folder' : 'other'} className="size-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {l.name}
                    {l.hasPassword && <Lock className="size-3.5 text-muted" aria-label="Password protected" />}
                    {!l.active && <Badge tone="warn">Expired</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {l.spaceName} · {l.path} · {l.expiresAt ? `until ${formatDate(l.expiresAt)}` : 'no expiry'} · {plural(l.views, 'view')}, {plural(l.downloads, 'download')}
                  </p>
                </div>
                <div className="flex gap-1">
                  <CopyButton text={l.url} label="Copy link" />
                  <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover:bg-subtle">
                    <ExternalLink className="size-4" aria-hidden /> Open
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => revoke(l)}>
                    Turn off
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
