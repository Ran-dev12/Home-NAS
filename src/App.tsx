import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Ellipsis, Folder, HardDrive, Images, KeyRound, Link2, LogOut, Server, Shield, Smartphone, Trash2, User as UserIcon } from 'lucide-react';
import { ApiError, STATE_EVENT, get, patch, post } from './lib/api.ts';
import { navigate, usePath, filesHref } from './lib/router.ts';
import type { Space, Status, User } from './lib/types.ts';
import { formatBytes } from './lib/format.ts';
import { useServerEventStream } from './lib/events.ts';
import { Button, Field, Input, Menu, Modal, ProgressBar, Spinner, cx, useToast } from './components/ui.tsx';
import { UploadProvider } from './components/uploads.tsx';
import { SetupView, OfflineView, LoginView } from './views/Onboarding.tsx';
import { FilesView } from './views/FilesView.tsx';
import { PhotosView } from './views/PhotosView.tsx';
import { PhonesView } from './views/PhonesView.tsx';
import { SharesView } from './views/SharesView.tsx';
import { TrashView } from './views/TrashView.tsx';
import { AdminView } from './views/AdminView.tsx';
import { SharePage } from './views/SharePage.tsx';
import { PairPage } from './views/PairPage.tsx';

export default function App() {
  const path = usePath();
  if (path.startsWith('/s/')) return <SharePage token={decodeURIComponent(path.slice(3).split('/')[0])} />;
  if (path.startsWith('/pair/')) return <PairPage code={decodeURIComponent(path.slice(6).split('/')[0])} />;
  return <Main />;
}

function Main() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await get<Status>('/api/status'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const on = () => void refresh();
    window.addEventListener(STATE_EVENT, on);
    return () => window.removeEventListener(STATE_EVENT, on);
  }, [refresh]);

  useEffect(() => {
    if (status) document.title = status.serverName;
  }, [status]);

  if (!status) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        {error ? (
          <>
            <p className="max-w-sm text-muted">{error}</p>
            <Button onClick={refresh}>Try again</Button>
          </>
        ) : (
          <Spinner label="Connecting" />
        )}
      </div>
    );
  }
  if (status.state === 'setup') return <SetupView status={status} onDone={refresh} />;
  if (status.state === 'offline') return <OfflineView status={status} onRetry={refresh} />;
  if (!status.user) return <LoginView status={status} onDone={refresh} />;
  return (
    <UploadProvider>
      <Shell status={status} user={status.user} onRefresh={refresh} />
    </UploadProvider>
  );
}

interface NavItem {
  to: string;
  match: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  admin?: boolean;
}

const NAV: NavItem[] = [
  { to: '/files', match: '/files', label: 'Files', icon: Folder },
  { to: '/photos', match: '/photos', label: 'Photos', icon: Images },
  { to: '/phones', match: '/phones', label: 'Phones', icon: Smartphone },
  { to: '/shares', match: '/shares', label: 'Shared links', icon: Link2 },
  { to: '/trash', match: '/trash', label: 'Trash', icon: Trash2 },
  { to: '/admin', match: '/admin', label: 'Admin', icon: Shield, admin: true },
];

interface MeResponse {
  user: User;
  spaces: Space[];
  disk: { totalBytes: number; freeBytes: number; usedBytes: number } | null;
}

function Shell({ status, user, onRefresh }: { status: Status; user: User; onRefresh: () => void }) {
  const path = usePath();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [account, setAccount] = useState(false);
  const toast = useToast();
  useServerEventStream(true);

  const loadMe = useCallback(() => {
    get<MeResponse>('/api/me')
      .then(setMe)
      .catch(() => {});
  }, []);
  useEffect(loadMe, [loadMe]);

  useEffect(() => {
    if (path === '/' || path === '/files') navigate(filesHref(`u:${user.id}`, '/'), true);
  }, [path, user.id]);

  const items = NAV.filter((n) => !n.admin || user.role === 'admin');
  const active = items.find((n) => path.startsWith(n.match));
  const logout = async () => {
    await post('/api/auth/logout').catch(() => {});
    navigate('/', true);
    onRefresh();
  };
  const disk = me?.disk;
  const usedPct = disk ? ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100 : 0;

  let content;
  if (!me) content = <Spinner className="m-10" />;
  else if (path.startsWith('/files/')) content = <FilesView spaces={me.spaces} user={user} onSpacesChanged={loadMe} />;
  else if (path.startsWith('/photos')) content = <PhotosView spaces={me.spaces} />;
  else if (path.startsWith('/phones')) content = <PhonesView user={user} />;
  else if (path.startsWith('/shares')) content = <SharesView />;
  else if (path.startsWith('/trash')) content = <TrashView />;
  else if (path.startsWith('/admin') && user.role === 'admin') content = <AdminView user={user} onChanged={loadMe} />;
  else content = <Spinner className="m-10" />;

  const userMenu = (
    <Menu
      label="Account"
      icon={UserIcon}
      align="left"
      items={[
        { label: 'Account settings', icon: KeyRound, onClick: () => setAccount(true) },
        { label: 'Sign out', icon: LogOut, onClick: logout },
      ]}
    />
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-card md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary-solid text-primary-fg">
            <Server className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{status.serverName}</p>
            <p className="truncate text-xs text-muted">{user.displayName}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
          {items.map((n) => (
            <a
              key={n.to}
              href={n.to}
              onClick={(e) => {
                e.preventDefault();
                navigate(n.to);
              }}
              aria-current={active === n ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active === n ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-subtle hover:text-fg',
              )}
            >
              <n.icon className="size-5" />
              {n.label}
            </a>
          ))}
        </nav>
        {disk && (
          <div className="mx-3 mb-3 rounded-xl bg-subtle p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <HardDrive className="size-4 text-muted" aria-hidden /> Storage
            </div>
            <ProgressBar value={usedPct} tone={usedPct > 90 ? 'danger' : usedPct > 75 ? 'warn' : 'primary'} label="Drive space used" />
            <p className="mt-1.5 text-xs text-muted">
              {formatBytes(disk.freeBytes)} free of {formatBytes(disk.totalBytes)}
            </p>
          </div>
        )}
        <div className="flex items-center gap-1 border-t border-line px-3 py-2">
          {userMenu}
          <span className="min-w-0 flex-1 truncate text-sm text-muted">@{user.username}</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-card/95 px-3 py-2 backdrop-blur md:hidden">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary-solid text-primary-fg">
            <Server className="size-4" aria-hidden />
          </div>
          <p className="min-w-0 flex-1 truncate font-semibold">{status.serverName}</p>
          {userMenu}
        </header>
        <main className="min-w-0 flex-1 pb-20 md:pb-0">{content}</main>
      </div>

      {/* Mobile bottom nav: four destinations plus "More" */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card md:hidden" aria-label="Main">
        {items.slice(0, 4).map((n) => (
          <a
            key={n.to}
            href={n.to}
            onClick={(e) => {
              e.preventDefault();
              navigate(n.to);
            }}
            aria-current={active === n ? 'page' : undefined}
            className={cx('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active === n ? 'text-primary' : 'text-muted')}
          >
            <n.icon className="size-5" />
            {n.label === 'Shared links' ? 'Links' : n.label}
          </a>
        ))}
        <div className={cx('flex min-h-14 flex-1 flex-col items-center justify-center', items.slice(4).includes(active!) ? 'text-primary' : 'text-muted')}>
          <Menu
            label="More"
            icon={Ellipsis}
            up
            items={[
              ...items.slice(4).map((n) => ({ label: n.label, icon: n.icon, onClick: () => navigate(n.to) })),
              { label: 'Account settings', icon: KeyRound, onClick: () => setAccount(true) },
              { label: 'Sign out', icon: LogOut, onClick: logout },
            ]}
          />
        </div>
      </nav>

      <AccountModal
        open={account}
        user={user}
        onClose={() => setAccount(false)}
        onSaved={() => {
          toast('Saved');
          onRefresh();
        }}
      />
    </div>
  );
}

function AccountModal({ open, user, onClose, onSaved }: { open: boolean; user: User; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.displayName);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(user.displayName);
      setCurrent('');
      setNext('');
      setError(null);
    }
  }, [open, user.displayName]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (name.trim() !== user.displayName) await patch('/api/me', { displayName: name.trim() });
      if (next) await post('/api/me/password', { current, next });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Account settings"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Display name" id="acc-name">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="text-sm font-medium">Change password</p>
        <Field label="Current password" id="acc-cur">
          <Input id="acc-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" id="acc-new" hint="At least 8 characters. Other signed-in devices will be signed out." error={error}>
          <Input id="acc-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
