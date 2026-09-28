import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Ellipsis, FolderPlus, KeyRound, Pencil, Plus, RefreshCw, Shield, ShieldOff, Smartphone, Trash2, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { del, get, patch, post } from '../lib/api.ts';
import { navigate, usePath } from '../lib/router.ts';
import { formatBytes, formatDateTime, plural, timeAgo } from '../lib/format.ts';
import type { ActivityRow, AdminSpace, AdminUser, Device, Settings, SystemInfo, User } from '../lib/types.ts';
import { useDebounced, useServerEvent } from '../lib/events.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Menu, Modal, Notice, PageHeader, ProgressBar, Select, Spinner, cx, useDialogs, useToast } from '../components/ui.tsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'spaces', label: 'Shared folders' },
  { id: 'phones', label: 'All phones' },
  { id: 'settings', label: 'Settings' },
] as const;

export function AdminView({ user, onChanged }: { user: User; onChanged: () => void }) {
  const path = usePath();
  const tab = (TABS.find((t) => path === `/admin/${t.id}`)?.id ?? 'overview') as (typeof TABS)[number]['id'];
  return (
    <div>
      <PageHeader title="Admin" subtitle="Storage health, people, shared folders and settings." />
      <div className="sticky top-[49px] z-20 border-b border-line bg-bg/95 px-4 backdrop-blur md:top-0 md:px-8">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => navigate(t.id === 'overview' ? '/admin' : `/admin/${t.id}`)}
              className={cx(
                'cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="px-4 py-5 md:px-8">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <UsersTab me={user} />}
        {tab === 'spaces' && <SpacesTab onChanged={onChanged} />}
        {tab === 'phones' && <AllPhones />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

// ---- Overview ----------------------------------------------------------------------------------------

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Overview() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([get<SystemInfo>('/api/admin/system'), get<{ activity: ActivityRow[] }>('/api/activity?limit=40')]);
      setSys(s);
      setActivity(a.activity);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  const reload = useDebounced(() => void load(), 800);
  useServerEvent('activity', reload);
  useServerEvent('index', reload);

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!sys) return <Spinner />;
  const disk = sys.volume.disk;
  const usedPct = disk ? ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100 : 0;
  const nasPct = disk ? (sys.index.bytes / disk.totalBytes) * 100 : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Storage drive</h2>
          <span className="font-mono text-sm text-muted">{sys.volume.root}</span>
        </div>
        {disk ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${usedPct.toFixed(0)}% of the drive used`}>
              <div className="bg-primary" style={{ width: `${nasPct}%` }} />
              <div className="bg-muted/40" style={{ width: `${Math.max(0, usedPct - nasPct)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-primary" /> HomeNAS {formatBytes(sys.index.bytes)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-muted/40" /> Other {formatBytes(Math.max(0, disk.usedBytes - sys.index.bytes))}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border border-line bg-subtle" /> Free {formatBytes(disk.freeBytes)} of {formatBytes(disk.totalBytes)}
              </span>
            </div>
            {usedPct > 90 && (
              <div className="mt-3">
                <Notice tone="danger">The drive is over 90% full. Uploads stop when free space runs low. Empty the trash or move files off.</Notice>
              </div>
            )}
          </>
        ) : (
          <Notice tone="warn">Could not read the drive’s size.</Notice>
        )}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Files" value={sys.index.files.toLocaleString()} sub={plural(sys.index.folders, 'folder')} />
          <Stat label="Photos" value={sys.index.photos.toLocaleString()} />
          <Stat label="Videos" value={sys.index.videos.toLocaleString()} />
          <Stat label="In trash" value={formatBytes(sys.trash.bytes)} sub={plural(sys.trash.items, 'item')} />
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Indexing</h2>
        {sys.index.scanning ? (
          <p className="text-sm text-muted">Scanning the drive… {sys.index.scanProgress.files.toLocaleString()} items checked</p>
        ) : (
          <p className="text-sm text-muted">
            {sys.index.lastScan
              ? `Last full scan ${timeAgo(sys.index.lastScan.at)}: ${sys.index.lastScan.files.toLocaleString()} items in ${(sys.index.lastScan.ms / 1000).toFixed(1)} s`
              : 'First scan starts shortly after the server starts.'}
          </p>
        )}
        {sys.index.mediaPending > 0 && (
          <div>
            <p className="mb-1 text-sm">Making thumbnails: {sys.index.mediaPending.toLocaleString()} to go</p>
            <ProgressBar value={Math.max(3, 100 - (sys.index.mediaPending / Math.max(1, sys.index.photos + sys.index.videos)) * 100)} label="Thumbnail progress" />
          </div>
        )}
        {sys.index.mediaErrors > 0 && <p className="text-sm text-muted">{plural(sys.index.mediaErrors, 'file')} could not be read for thumbnails (damaged or unusual formats). The files themselves are fine.</p>}
        {!sys.server.ffmpeg && (
          <Notice tone="warn" title="Video thumbnails are off">
            Install ffmpeg on this PC (for example with <code className="font-mono">winget install ffmpeg</code>) and restart HomeNAS.
          </Notice>
        )}
        <Button
          icon={RefreshCw}
          disabled={sys.index.scanning}
          className="self-start"
          onClick={async () => {
            await post('/api/admin/rescan');
            setTimeout(load, 500);
          }}
        >
          Scan now
        </Button>
        <p className="text-xs text-muted">A scan picks up files copied onto the drive outside HomeNAS, for example with Windows Explorer.</p>
      </Card>

      <Card className="p-5 lg:col-span-2">
        <h2 className="mb-3 font-semibold">Recent activity</h2>
        {!activity?.length ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-muted" title={formatDateTime(a.at)}>
                  {timeAgo(a.at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.device ?? a.who ?? 'Someone'}</span> {describe(a)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">This PC</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted">Name</dt>
          <dd>{sys.server.hostname}</dd>
          <dt className="text-muted">Addresses</dt>
          <dd className="font-mono text-xs">
            {sys.server.lan.length
              ? sys.server.lan.map((l) => (
                  <div key={l.address}>
                    http://{l.address}:{sys.server.port}
                    {l.kind === 'tailscale' && ' (Tailscale)'}
                  </div>
                ))
              : '—'}
          </dd>
          <dt className="text-muted">Running for</dt>
          <dd>{formatUptime(sys.server.uptimeSec)}</dd>
          <dt className="text-muted">System</dt>
          <dd>
            {sys.server.platform} · Node {sys.server.node}
          </dd>
        </dl>
      </Card>
    </div>
  );
}

function formatUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

function describe(a: ActivityRow): string {
  const p = a.path ?? '';
  const d = a.detail ? ` (${a.detail})` : '';
  switch (a.action) {
    case 'upload':
      return a.detail ? `uploaded ${a.detail} to ${p}` : `uploaded ${p}`;
    case 'mkdir':
      return `created folder ${p}`;
    case 'rename':
      return `renamed ${a.detail} to ${p}`;
    case 'move':
      return `moved ${a.detail} to ${p}`;
    case 'copy':
      return `copied ${a.detail} to ${p}`;
    case 'delete':
      return a.detail ? `deleted ${a.detail} from ${p}` : `deleted ${p}`;
    case 'restore':
      return `restored ${p}${d}`;
    case 'purge':
      return `emptied trash${d}`;
    case 'share':
      return `made a share link for ${p}${d}`;
    case 'phone_backup':
      return `backed up: ${a.detail?.split(': ')[1] ?? ''}`;
    case 'device_added':
      return `added phone ${a.detail}`;
    case 'device_removed':
      return `removed phone ${a.detail}`;
    case 'user_added':
      return `added user ${a.detail}`;
    case 'user_changed':
      return `changed account ${a.detail}`;
    case 'space_added':
      return `created shared folder ${a.detail}`;
    case 'space_removed':
      return `removed shared folder ${a.detail}`;
    case 'setup':
      return `set up HomeNAS${d}`;
    default:
      return `${a.action} ${p}${d}`;
  }
}

// ---- Users -------------------------------------------------------------------------------------------

function UsersTab({ me }: { me: User }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const dialogs = useDialogs();
  const load = useCallback(() => {
    get<{ users: AdminUser[] }>('/api/admin/users')
      .then((r) => setUsers(r.users))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const change = async (u: AdminUser, body: Record<string, unknown>, done: string) => {
    try {
      await patch(`/api/admin/users/${u.id}`, body);
      toast(done);
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between gap-2">
        <p className="text-sm text-muted">Each person gets a private “My files” folder. Not even admins can open someone else’s.</p>
        <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
          Add person
        </Button>
      </div>
      {!users ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-card">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-subtle font-semibold text-muted">{u.displayName.slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {u.displayName}
                  {u.role === 'admin' && <Badge tone="primary">Admin</Badge>}
                  {u.disabled && <Badge tone="danger">Disabled</Badge>}
                  {u.id === me.id && <Badge>You</Badge>}
                </p>
                <p className="text-sm text-muted">
                  @{u.username} · {formatBytes(u.usedBytes)} in {plural(u.files, 'file')} · {plural(u.devices, 'phone')} · seen {timeAgo(u.lastSeenAt)}
                </p>
              </div>
              <Menu
                label={`Options for ${u.displayName}`}
                icon={Ellipsis}
                items={[
                  {
                    label: 'Reset password',
                    icon: KeyRound,
                    onClick: () =>
                      dialogs.prompt({
                        title: `New password for ${u.displayName}`,
                        label: 'New password',
                        inputType: 'text',
                        hint: 'At least 8 characters. They will be signed out everywhere.',
                        confirmLabel: 'Set password',
                        onSubmit: async (pw) => {
                          await patch(`/api/admin/users/${u.id}`, { password: pw });
                          toast('Password changed');
                        },
                      }),
                  },
                  {
                    label: 'Change name',
                    icon: Pencil,
                    onClick: () =>
                      dialogs.prompt({
                        title: 'Display name',
                        label: 'Name',
                        initial: u.displayName,
                        onSubmit: async (displayName) => {
                          await patch(`/api/admin/users/${u.id}`, { displayName });
                          load();
                        },
                      }),
                  },
                  u.role === 'admin'
                    ? { label: 'Remove admin rights', icon: ShieldOff, onClick: () => change(u, { role: 'member' }, 'Now a regular member') }
                    : { label: 'Make admin', icon: Shield, onClick: () => change(u, { role: 'admin' }, 'Now an admin') },
                  u.disabled
                    ? { label: 'Enable account', icon: UserCheck, onClick: () => change(u, { disabled: false }, 'Account enabled') }
                    : {
                        label: 'Disable account',
                        icon: UserX,
                        danger: true,
                        hidden: u.id === me.id,
                        onClick: async () => {
                          const ok = await dialogs.confirm({
                            title: `Disable ${u.displayName}?`,
                            body: 'They are signed out and cannot sign in, and their phones stop backing up. Their files stay on the drive.',
                            confirmLabel: 'Disable',
                            danger: true,
                          });
                          if (ok) void change(u, { disabled: true }, 'Account disabled');
                        },
                      },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      <AddUserModal open={adding} onClose={() => setAdding(false)} onDone={load} />
    </div>
  );
}

function AddUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ displayName: '', username: '', password: '', role: 'member' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF({ displayName: '', username: '', password: '', role: 'member' });
      setError(null);
    }
  }, [open]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/admin/users', f);
      onDone();
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
      title="Add a person"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!f.username || f.password.length < 8}>
            Add
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" id="nu-name">
          <Input id="nu-name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} autoFocus />
        </Field>
        <Field label="Username" id="nu-user" hint="Used to sign in.">
          <Input id="nu-user" value={f.username} autoCapitalize="none" onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label="Password" id="nu-pass" hint="At least 8 characters. They can change it later.">
          <Input id="nu-pass" type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Role" id="nu-role">
          <Select id="nu-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="member">Member</option>
            <option value="admin">Admin: can manage people and settings</option>
          </Select>
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---- Shared folders ----------------------------------------------------------------------------------

function SpacesTab({ onChanged }: { onChanged: () => void }) {
  const [spaces, setSpaces] = useState<AdminSpace[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editing, setEditing] = useState<AdminSpace | 'new' | null>(null);
  const toast = useToast();
  const dialogs = useDialogs();
  const load = useCallback(() => {
    Promise.all([get<{ spaces: AdminSpace[] }>('/api/admin/spaces'), get<{ users: AdminUser[] }>('/api/admin/users')])
      .then(([s, u]) => {
        setSpaces(s.spaces);
        setUsers(u.users);
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between gap-2">
        <p className="text-sm text-muted">Shared folders are visible to the people you add, with read-only or full access. Admins can always open them.</p>
        <Button variant="primary" icon={FolderPlus} onClick={() => setEditing('new')}>
          New shared folder
        </Button>
      </div>
      {!spaces ? (
        <Spinner />
      ) : spaces.length === 0 ? (
        <EmptyState icon={Users} title="No shared folders yet" action={<Button icon={Plus} onClick={() => setEditing('new')}>Create one, for example “Family”</Button>}>
          A place everyone can put holiday photos, documents or music.
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {spaces.map((s) => (
            <Card key={s.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-sm text-muted">
                    {formatBytes(s.usedBytes)} · {plural(s.files, 'file')} · on drive: shared\{s.folder}
                  </p>
                </div>
                <Menu
                  label={`Options for ${s.name}`}
                  icon={Ellipsis}
                  items={[
                    { label: 'Edit name and people', icon: Pencil, onClick: () => setEditing(s) },
                    {
                      label: 'Delete',
                      icon: Trash2,
                      danger: true,
                      onClick: async () => {
                        const ok = await dialogs.confirm({ title: `Delete “${s.name}”?`, body: 'Only an empty shared folder can be deleted.', confirmLabel: 'Delete', danger: true });
                        if (!ok) return;
                        try {
                          await del(`/api/admin/spaces/${s.numericId}`);
                          load();
                          onChanged();
                        } catch (e) {
                          toast((e as Error).message, 'error');
                        }
                      },
                    },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.members.length === 0 ? (
                  <span className="text-sm text-muted">Only admins</span>
                ) : (
                  s.members.map((m) => (
                    <Badge key={m.userId} tone={m.access === 'write' ? 'primary' : 'neutral'}>
                      {m.displayName} · {m.access === 'write' ? 'can edit' : 'view only'}
                    </Badge>
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <SpaceModal
        target={editing}
        users={users}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
          onChanged();
        }}
      />
    </div>
  );
}

function SpaceModal({ target, users, onClose, onSaved }: { target: AdminSpace | 'new' | null; users: AdminUser[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [access, setAccess] = useState<Record<number, '' | 'read' | 'write'>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    setError(null);
    if (target === 'new') {
      setName('');
      setAccess(Object.fromEntries(users.filter((u) => !u.disabled).map((u) => [u.id, 'write'])));
    } else {
      setName(target.name);
      setAccess(Object.fromEntries(target.members.map((m) => [m.userId, m.access])));
    }
  }, [target, users]);
  const save = async () => {
    setBusy(true);
    setError(null);
    const members = Object.entries(access)
      .filter(([, a]) => a)
      .map(([userId, a]) => ({ userId: Number(userId), access: a }));
    try {
      if (target === 'new') await post('/api/admin/spaces', { name, members });
      else if (target) await patch(`/api/admin/spaces/${target.numericId}`, { name, members });
      onSaved();
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
      title={target === 'new' ? 'New shared folder' : `Edit “${target?.name ?? ''}”`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" id="sp-name">
          <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Family" autoFocus />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium">Who can use it</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {u.displayName} <span className="text-muted">@{u.username}</span>
                </span>
                <Select
                  aria-label={`Access for ${u.displayName}`}
                  value={access[u.id] ?? ''}
                  onChange={(e) => setAccess({ ...access, [u.id]: e.target.value as '' | 'read' | 'write' })}
                  className="h-9 w-40"
                >
                  <option value="">No access</option>
                  <option value="read">View only</option>
                  <option value="write">Can edit</option>
                </Select>
              </li>
            ))}
          </ul>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

// ---- All phones ---------------------------------------------------------------------------------------

function AllPhones() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  useEffect(() => {
    get<{ devices: Device[] }>('/api/devices?all=1')
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, []);
  if (!devices) return <Spinner />;
  if (!devices.length) return <EmptyState icon={Smartphone} title="No phones have been added" />;
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-card">
      {devices.map((d) => {
        const stale = !d.lastSyncAt || Date.now() - Date.parse(d.lastSyncAt) > 3 * 86400_000;
        return (
          <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Smartphone className="size-5 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {d.name} <span className="font-normal text-muted">· {d.owner}</span>
              </p>
              <p className="text-sm text-muted">
                Last backup {timeAgo(d.lastSyncAt)} · {d.totalFiles.toLocaleString()} files · {formatBytes(d.totalBytes)}
              </p>
            </div>
            {d.orderWarning && <Badge tone="warn">Wrong sort order</Badge>}
            {stale && <Badge tone="warn">{d.lastSyncAt ? 'No backup in 3+ days' : 'Never backed up'}</Badge>}
          </li>
        );
      })}
    </ul>
  );
}

// ---- Settings -----------------------------------------------------------------------------------------

function SettingsTab() {
  const [s, setS] = useState<Settings | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    get<{ settings: Settings }>('/api/admin/settings')
      .then((r) => setS(r.settings))
      .catch((e) => setError(e.message));
    get<{ candidates: string[] }>('/api/devices')
      .then((r) => setCandidates(r.candidates))
      .catch(() => {});
  }, []);
  if (!s) return error ? <Notice tone="danger">{error}</Notice> : <Spinner />;
  const num = (k: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setS((await patch<{ settings: Settings }>('/api/admin/settings', s)).settings);
      toast('Settings saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex max-w-2xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Name" id="st-name" hint="Shown when signing in, in the browser tab and in phone notifications.">
        <Input id="st-name" value={s.serverName} onChange={(e) => setS({ ...s, serverName: e.target.value })} />
      </Field>
      <Field
        label="Address for phones and share links"
        id="st-url"
        hint={
          <>
            Leave empty to detect it automatically. Set it if the PC has several network adapters, or give the PC a fixed address in your router (DHCP reservation) and enter it here.
            {candidates.length > 0 && <> Detected: {candidates.join(', ')}</>}
          </>
        }
      >
        <Input id="st-url" value={s.publicUrl} placeholder={candidates[0] ?? 'http://192.168.1.20:4300'} onChange={(e) => setS({ ...s, publicUrl: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Keep deleted items for (days)" id="st-trash" hint="0 keeps them until the trash is emptied by hand.">
          <Input id="st-trash" type="number" min={0} value={s.trashDays} onChange={num('trashDays')} />
        </Field>
        <Field label="Largest single upload (GB)" id="st-max">
          <Input id="st-max" type="number" min={1} value={s.maxUploadGb} onChange={num('maxUploadGb')} />
        </Field>
        <Field label="Always keep free on the drive (GB)" id="st-free" hint="Uploads are refused below this, so the drive never fills completely.">
          <Input id="st-free" type="number" min={0} value={s.minFreeGb} onChange={num('minFreeGb')} />
        </Field>
        <Field label="Rescan the drive every (minutes)" id="st-scan" hint="Picks up files copied onto the SSD directly.">
          <Input id="st-scan" type="number" min={5} value={s.scanMinutes} onChange={num('scanMinutes')} />
        </Field>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
