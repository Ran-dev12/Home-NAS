import { useEffect, useState, type ReactNode } from 'react';
import { HardDrive, LogIn, Server, Unplug } from 'lucide-react';
import { ApiError, get, post } from '../lib/api.ts';
import { formatBytes, formatDate } from '../lib/format.ts';
import type { Status } from '../lib/types.ts';
import { Badge, Button, Card, Field, Input, Notice, Spinner, cx } from '../components/ui.tsx';

function Centered({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <div className={cx('w-full', wide ? 'max-w-2xl' : 'max-w-sm')}>{children}</div>
    </div>
  );
}

function Brand({ name, subtitle }: { name: string; subtitle: string }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-primary-solid text-primary-fg">
        <Server className="size-6" aria-hidden />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

// ---- Sign in -------------------------------------------------------------------------------------------

export function LoginView({ status, onDone }: { status: Status; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/login', { username, password });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Centered>
      <Brand name={status.serverName} subtitle="Sign in to your home storage" />
      <Card className="p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Username" id="login-user">
            <Input id="login-user" autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
          <Field label="Password" id="login-pass" error={error}>
            <Input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" icon={LogIn} loading={busy} disabled={!username || !password}>
            Sign in
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-xs text-muted">Forgot your password? Ask whoever runs the NAS to reset it.</p>
    </Centered>
  );
}

// ---- Drive disconnected --------------------------------------------------------------------------------

export function OfflineView({ status, onRetry }: { status: Status; onRetry: () => void }) {
  const [showMove, setShowMove] = useState(false);
  const [path, setPath] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(onRetry, 4000); // the server re-attaches on its own; just notice when it does
    return () => clearInterval(t);
  }, [onRetry]);

  const relocate = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/setup/relocate', { path, code });
      onRetry();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-warn-soft text-warn">
          <Unplug className="size-7" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold">Storage drive not connected</h1>
        <p className="text-sm text-muted">
          {status.serverName} is waiting for its drive{status.storageRoot ? (
            <>
              {' '}
              at <span className="font-mono text-fg">{status.storageRoot}</span>
            </>
          ) : null}
          . Plug the SSD back in. This page reconnects by itself within a few seconds.
        </p>
        <Spinner label="Waiting for the drive" />
        <button type="button" className="mt-2 cursor-pointer text-sm font-medium text-primary hover:underline" onClick={() => setShowMove(!showMove)}>
          The drive is plugged in but has a new drive letter?
        </button>
        {showMove && (
          <form
            className="flex w-full flex-col gap-3 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              void relocate();
            }}
          >
            <Field label="New location of the HomeNAS folder" id="reloc-path" hint="For example E:\HomeNAS on Windows, or /mnt/ssd/HomeNAS on a Raspberry Pi">
              <Input id="reloc-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="E:\HomeNAS" />
            </Field>
            {status.needsSetupCode && (
              <Field label="Setup code" id="reloc-code" hint="Shown where HomeNAS runs: its window on a PC, or “sudo journalctl -u homenas” on a Raspberry Pi">
                <Input id="reloc-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="primary" loading={busy} disabled={!path}>
              Use this location
            </Button>
          </form>
        )}
      </Card>
    </Centered>
  );
}

// ---- First-run setup -----------------------------------------------------------------------------------

interface Drive {
  path: string;
  totalBytes: number;
  freeBytes: number;
  isSystem: boolean;
  kind: 'local' | 'removable' | 'network' | 'other';
  label: string;
  fileSystem: string;
  provider?: string;
}

interface Inspection {
  path: string;
  exists: boolean;
  existingVolume: { name: string; createdAt: string } | null;
  freeBytes: number | null;
  totalBytes: number | null;
  problems: string[];
  warnings: string[];
}

export function SetupView({ status, onDone }: { status: Status; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [codeOk, setCodeOk] = useState(!status.needsSetupCode);
  const [drives, setDrives] = useState<Drive[] | null>(null);
  const [path, setPath] = useState('');
  const [check, setCheck] = useState<Inspection | null>(null);
  const [step, setStep] = useState<'drive' | 'admin'>('drive');
  const [serverName, setServerName] = useState('HomeNAS');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = status.needsSetupCode ? `?code=${encodeURIComponent(code)}` : '';

  const loadDrives = async () => {
    setError(null);
    try {
      const r = await get<{ drives: Drive[] }>(`/api/setup/drives${q}`);
      setDrives(r.drives);
      setCodeOk(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (codeOk) void loadDrives();
  }, []);

  const inspect = async (p = path) => {
    setBusy(true);
    setError(null);
    try {
      setCheck(await post<Inspection>('/api/setup/inspect', { path: p, code }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickDrive = (d: Drive) => {
    const sep = d.path.includes('\\') ? '\\' : '/';
    const p = d.path.endsWith(sep) ? `${d.path}HomeNAS` : `${d.path}${sep}HomeNAS`;
    setPath(p);
    void inspect(p);
  };

  const finish = async () => {
    setError(null);
    if (!check?.existingVolume && password !== password2) return setError('The two passwords do not match');
    setBusy(true);
    try {
      await post('/api/setup/complete', {
        code,
        path: check?.path ?? path,
        serverName,
        volumeName: serverName,
        admin: { username, displayName: displayName || username, password },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Setup failed');
      setBusy(false);
    }
  };

  if (!codeOk) {
    return (
      <Centered>
        <Brand name="Set up HomeNAS" subtitle="First-time setup" />
        <Card className="p-5">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void loadDrives();
            }}
          >
            <p className="text-sm text-muted">You are setting up from another device. Enter the 6-digit setup code. It is shown where HomeNAS runs: in its window on a PC, or on a Raspberry Pi with <code className="font-mono">sudo journalctl -u homenas</code>.</p>
            <Field label="Setup code" id="setup-code" error={error}>
              <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </Field>
            <Button type="submit" variant="primary" disabled={code.length < 6}>
              Continue
            </Button>
          </form>
        </Card>
      </Centered>
    );
  }

  const canContinue = !!check && check.problems.length === 0;

  return (
    <Centered wide>
      <Brand name="Set up HomeNAS" subtitle={step === 'drive' ? 'Step 1 of 2 · Choose where files are stored' : 'Step 2 of 2 · Create your administrator account'} />
      {step === 'drive' ? (
        <Card className="flex flex-col gap-5 p-5">
          <p className="text-sm text-muted">
            Pick the external SSD. Everything lives on that drive: your files, the database, thumbnails and the trash. Unplug it and move it to another PC, and HomeNAS comes with it.
          </p>
          {!drives ? (
            <Spinner />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {[...drives]
                .sort((a, b) => Number(a.kind === 'network') - Number(b.kind === 'network') || Number(a.isSystem) - Number(b.isSystem))
                .map((d) => {
                  const network = d.kind === 'network';
                  const pct = d.totalBytes ? ((d.totalBytes - d.freeBytes) / d.totalBytes) * 100 : 0;
                  const selected = !network && path.toLowerCase().startsWith(d.path.toLowerCase());
                  return (
                    <button
                      key={d.path}
                      type="button"
                      disabled={network}
                      onClick={() => pickDrive(d)}
                      title={network ? `Network drive (${d.provider ?? 'shared folder'}), cannot hold HomeNAS` : undefined}
                      className={cx(
                        'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                        network ? 'cursor-not-allowed border-dashed border-line opacity-60' : 'cursor-pointer',
                        selected ? 'border-primary bg-primary-soft' : !network && 'border-line hover:bg-subtle',
                      )}
                    >
                      <HardDrive className={cx('mt-0.5 size-6 shrink-0', selected ? 'text-primary' : 'text-muted')} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold">{d.path}</span>
                          {d.label && <span className="truncate text-sm">{d.label}</span>}
                          {d.isSystem && <Badge tone="warn">System drive</Badge>}
                          {network && <Badge>Network drive</Badge>}
                          {d.kind === 'removable' && <Badge tone="primary">Removable</Badge>}
                        </div>
                        {network ? (
                          <p className="mt-1 truncate text-xs text-muted">{d.provider ?? 'Shared folder on another computer'} · not supported</p>
                        ) : (
                          <>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {formatBytes(d.freeBytes)} free of {formatBytes(d.totalBytes)}
                              {d.fileSystem && ` · ${d.fileSystem}`}
                            </p>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void inspect();
            }}
          >
            <Field label="Storage folder" id="setup-path" hint="A new or empty folder on the SSD. It is created if it does not exist.">
              <div className="flex gap-2">
                <Input id="setup-path" value={path} onChange={(e) => (setPath(e.target.value), setCheck(null))} placeholder="D:\HomeNAS" className="font-mono" />
                <Button type="submit" loading={busy} disabled={!path}>
                  Check
                </Button>
              </div>
            </Field>
          </form>
          {check && (
            <div className="flex flex-col gap-2">
              {check.problems.map((p) => (
                <Notice key={p} tone="danger">
                  {p}
                </Notice>
              ))}
              {check.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
              {check.existingVolume && (
                <Notice tone="info" title={`Existing HomeNAS storage found: “${check.existingVolume.name}”`}>
                  Created {formatDate(check.existingVolume.createdAt)}. Connecting it keeps all its users, files, shared folders and phone backups. You will sign in with an existing account.
                </Notice>
              )}
              {canContinue && !check.existingVolume && (
                <Notice tone="ok">
                  Ready. {formatBytes(check.freeBytes)} free on this drive.
                </Notice>
              )}
            </div>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end">
            {check?.existingVolume ? (
              <Button variant="primary" disabled={!canContinue} loading={busy} onClick={finish}>
                Connect this storage
              </Button>
            ) : (
              <Button variant="primary" disabled={!canContinue} onClick={() => setStep('admin')}>
                Continue
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void finish();
            }}
          >
            <Field label="Name for this NAS" id="setup-server" hint="Shown on the sign-in page and in phone notifications.">
              <Input id="setup-server" value={serverName} onChange={(e) => setServerName(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" id="setup-display">
                <Input id="setup-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Username" id="setup-user" hint="Letters, numbers, dot or dash.">
                <Input id="setup-user" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" />
              </Field>
              <Field label="Password" id="setup-pass" hint="At least 8 characters.">
                <Input id="setup-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Password again" id="setup-pass2">
                <Input id="setup-pass2" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            <p className="text-sm text-muted">
              Storage: <span className="font-mono text-fg">{check?.path}</span>
            </p>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-between gap-2">
              <Button onClick={() => setStep('drive')}>Back</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!username || password.length < 8}>
                Create and sign in
              </Button>
            </div>
          </form>
        </Card>
      )}
    </Centered>
  );
}
