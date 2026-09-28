import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Ellipsis, FolderOpen, KeyRound, ListChecks, Pencil, Plus, SlidersHorizontal, Smartphone, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../lib/api.ts';
import { filesHref, navigate } from '../lib/router.ts';
import { formatBytes, formatDateTime, plural, timeAgo } from '../lib/format.ts';
import type { BackupChoice, Device, DeviceSecret, User } from '../lib/types.ts';
import { useDebounced, useServerEvent } from '../lib/events.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Menu, Modal, Notice, PageHeader, Select, Spinner, useDialogs, useToast } from '../components/ui.tsx';
import { ShortcutGuide } from '../components/ShortcutGuide.tsx';

interface DevicesResponse {
  devices: Device[];
  baseUrl: string;
  candidates: string[];
}

export function PhonesView({ user }: { user: User }) {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [serverName, setServerName] = useState('HomeNAS');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [guide, setGuide] = useState<{ device: Device; secret?: DeviceSecret; choicesChanged?: boolean } | null>(null);
  const [choosing, setChoosing] = useState<Device | null>(null);
  const toast = useToast();
  const dialogs = useDialogs();

  const load = useCallback(async () => {
    try {
      setData(await get<DevicesResponse>('/api/devices'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    get<{ serverName: string }>('/api/status')
      .then((s) => setServerName(s.serverName))
      .catch(() => {});
  }, [load]);
  const reload = useDebounced(() => void load(), 1000);
  useServerEvent('device', reload);

  const newToken = async (d: Device) => {
    const ok = await dialogs.confirm({
      title: `New token for ${d.name}?`,
      body: 'The current key stops working straight away. On the phone, paste the new one into the shortcut’s second Text action (the one starting with “Bearer”).',
      confirmLabel: 'Make new token',
    });
    if (!ok) return;
    const secret = await post<DeviceSecret>(`/api/devices/${d.id}/token`);
    setGuide({ device: secret.device, secret });
    void load();
  };

  const rename = (d: Device) =>
    dialogs.prompt({
      title: 'Rename phone',
      label: 'Name',
      initial: d.name,
      hint: 'The backup folder keeps its current name.',
      onSubmit: async (name) => {
        await patch(`/api/devices/${d.id}`, { name });
        await load();
      },
    });

  const resetFrom = (d: Device) =>
    dialogs.prompt({
      title: 'Back up again from a date',
      label: 'Start date',
      inputType: 'date',
      initial: '2000-01-01',
      confirmLabel: 'Set',
      hint: 'The next runs re-send photos taken after this date. Photos already on the NAS are recognised and skipped, so nothing is duplicated. Use this if photos were added to the phone with old dates (for example AirDropped).',
      onSubmit: async (date) => {
        await patch(`/api/devices/${d.id}`, { resetFrom: date });
        toast('The next backup starts from that date');
        await load();
      },
    });

  const remove = async (d: Device) => {
    const ok = await dialogs.confirm({
      title: `Remove ${d.name}?`,
      body: `The phone can no longer upload. Its ${plural(d.totalFiles, 'backed-up file')} stay in ${d.folder}. Also delete the automation on the phone.`,
      confirmLabel: 'Remove phone',
      danger: true,
    });
    if (!ok) return;
    await del(`/api/devices/${d.id}`);
    toast('Phone removed');
    void load();
  };

  return (
    <div>
      <PageHeader
        title="Phones"
        subtitle="iPhones back up photos, videos and files here over Wi-Fi whenever they charge at home, using the built-in Shortcuts app."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Add phone
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-8 md:px-8">
        {error && <Notice tone="danger">{error}</Notice>}
        {!data ? (
          <Spinner className="m-6" />
        ) : data.devices.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="No phones yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                Add your first phone
              </Button>
            }
          >
            Add a phone to get a one-time setup code. Build a short shortcut once (about five minutes), and from then on the phone backs up every time it charges at home.
          </EmptyState>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.devices.map((d) => (
              <DeviceCard
                key={d.id}
                d={d}
                onGuide={() => setGuide({ device: d })}
                onChoices={() => setChoosing(d)}
                onFolder={() => navigate(filesHref(`u:${user.id}`, d.folder))}
                onNewToken={() => newToken(d)}
                onRename={() => rename(d)}
                onReset={() => resetFrom(d)}
                onRemove={() => remove(d)}
              />
            ))}
          </div>
        )}
      </div>

      <AddPhoneModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(secret) => {
          setAdding(false);
          setGuide({ device: secret.device, secret });
          void load();
        }}
      />

      <BackupChoiceModal
        device={choosing}
        onClose={() => setChoosing(null)}
        onSaved={(device) => {
          setChoosing(null);
          setGuide({ device, choicesChanged: true });
          void load();
        }}
      />

      <Modal open={!!guide} onClose={() => setGuide(null)} title={`Set up ${guide?.device.name ?? ''}`} size="lg" footer={<Button variant="primary" onClick={() => setGuide(null)}>Done</Button>}>
        {guide && data && (
          <ShortcutGuide
            serverName={serverName}
            deviceName={guide.device.name}
            baseUrl={guide.secret?.baseUrl ?? data.baseUrl}
            candidates={data.candidates}
            token={guide.secret?.token}
            tokenHint={guide.device.tokenHint}
            limit={guide.device.batchLimit}
            backup={guide.device.backup}
            choicesChanged={guide.choicesChanged}
            pairUrl={guide.secret?.pairUrl}
            pairExpiresAt={guide.secret?.pairExpiresAt}
            onNewToken={guide.secret ? undefined : () => newToken(guide.device)}
          />
        )}
      </Modal>
    </div>
  );
}

function DeviceCard({
  d,
  onGuide,
  onChoices,
  onFolder,
  onNewToken,
  onRename,
  onReset,
  onRemove,
}: {
  d: Device;
  onGuide: () => void;
  onChoices: () => void;
  onFolder: () => void;
  onNewToken: () => void;
  onRename: () => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  const never = !d.lastSyncAt;
  const stale = d.lastSyncAt && Date.now() - Date.parse(d.lastSyncAt) > 3 * 86400_000;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Smartphone className="size-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{d.name}</p>
          <p className="text-sm text-muted">
            {never ? 'Waiting for the first backup' : `Last backup ${timeAgo(d.lastSyncAt)}`}
            {d.owner ? ` · ${d.owner}` : ''}
          </p>
        </div>
        {never ? <Badge tone="warn">Not set up</Badge> : stale ? <Badge tone="warn">No backup in 3+ days</Badge> : <Badge tone="ok">Active</Badge>}
        <Menu
          label={`Options for ${d.name}`}
          icon={Ellipsis}
          items={[
            { label: 'Setup steps', icon: ListChecks, onClick: onGuide },
            { label: 'What to back up…', icon: SlidersHorizontal, onClick: onChoices },
            { label: 'Open backup folder', icon: FolderOpen, onClick: onFolder },
            { label: 'New token', icon: KeyRound, onClick: onNewToken },
            { label: 'Rename', icon: Pencil, onClick: onRename },
            { label: 'Back up again from…', icon: CalendarClock, onClick: onReset },
            { label: 'Remove phone', icon: Trash2, onClick: onRemove, danger: true },
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Backs up">
        {CHOICES.filter((c) => d.backup[c.key]).map((c) => (
          <Badge key={c.key} tone="primary">
            {c.label}
          </Badge>
        ))}
      </div>
      {d.orderWarning && (
        <Notice tone="warn" title="The shortcut sends photos newest first">
          Open the shortcut’s <b>Find Photos</b> step and set the order to <b>Oldest First</b>. Until then the NAS re-checks the same photos every run. Nothing is lost, but it is slower.
        </Notice>
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Backed up</dt>
          <dd className="font-medium">
            {d.totalFiles.toLocaleString()} · {formatBytes(d.totalBytes)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Up to</dt>
          <dd className="font-medium" title="The newest photo the NAS is sure it has">
            {d.backedUpThrough ? formatDateTime(d.backedUpThrough) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Last run</dt>
          <dd className="font-medium">
            {d.lastRun.startedAt ? `${d.lastRun.stored} new, ${d.lastRun.skipped + d.lastRun.excluded} skipped` : '—'}
          </dd>
        </div>
      </dl>
      {never && (
        <Button icon={ListChecks} onClick={onGuide} className="self-start">
          Show setup steps
        </Button>
      )}
    </Card>
  );
}

function AddPhoneModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: DeviceSecret) => void }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState<'everything' | 'date' | 'now'>('everything');
  const [date, setDate] = useState('');
  const [limit, setLimit] = useState('300');
  const [backup, setBackup] = useState<BackupChoice>(DEFAULT_CHOICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setStart('everything');
      setDate('');
      setBackup(DEFAULT_CHOICE);
      setError(null);
    }
  }, [open]);
  const media = backup.photos || backup.videos || backup.screenshots;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await post<DeviceSecret>('/api/devices', { name, startFrom: start === 'date' ? date : start, batchLimit: Number(limit), backup }));
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
      title="Add a phone"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || (media && start === 'date' && !date) || !anyChoice(backup)} onClick={create}>
            Continue
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Phone name" id="ph-name" hint="Each phone gets its own folder: Phone Backup/<this name> in your files.">
          <Input id="ph-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ranjeet’s iPhone" autoFocus />
        </Field>
        <BackupChoices value={backup} onChange={setBackup} />
        {media && (
          <Field label="Photos and videos to start from" id="ph-start">
            <Select id="ph-start" value={start} onChange={(e) => setStart(e.target.value as typeof start)}>
              <option value="everything">Everything already on the phone</option>
              <option value="date">Taken after a date</option>
              <option value="now">Only new ones from now on</option>
            </Select>
          </Field>
        )}
        {media && start === 'date' && (
          <Field label="Start date" id="ph-date">
            <Input id="ph-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {media && (
          <Field label="Photos and videos per run" id="ph-limit" hint="Smaller runs finish reliably. Each run continues where the last one stopped.">
            <Select id="ph-limit" value={limit} onChange={(e) => setLimit(e.target.value)}>
              <option value="100">100</option>
              <option value="300">300 (recommended)</option>
              <option value="1000">1,000</option>
            </Select>
          </Field>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

const DEFAULT_CHOICE: BackupChoice = { photos: true, videos: true, screenshots: true, files: false };

const CHOICES: { key: keyof BackupChoice; label: string; hint: string }[] = [
  { key: 'photos', label: 'Photos', hint: 'Everything in the Photos app, sorted by year and month.' },
  { key: 'videos', label: 'Videos', hint: 'Kept in their own folder. Videos are large, so the first backup takes a few charges.' },
  { key: 'screenshots', label: 'Screenshots', hint: 'Kept apart from real photos.' },
  { key: 'files', label: 'Files and folders', hint: 'Folders you pick from the Files app (iCloud Drive or On My iPhone). New and changed files are sent each time.' },
];

const anyChoice = (b: BackupChoice) => b.photos || b.videos || b.screenshots || b.files;

function BackupChoices({ value, onChange }: { value: BackupChoice; onChange: (b: BackupChoice) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-fg">What to back up</legend>
      <div className="flex flex-col gap-0.5">
        {CHOICES.map((c) => (
          <label key={c.key} className="-mx-2 flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-subtle">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
              checked={value[c.key]}
              onChange={(e) => onChange({ ...value, [c.key]: e.target.checked })}
            />
            <span className="text-sm">
              <span className="font-medium text-fg">{c.label}</span>
              <span className="block text-muted">{c.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {!anyChoice(value) && <p className="text-sm text-danger">Choose at least one.</p>}
    </fieldset>
  );
}

function BackupChoiceModal({ device, onClose, onSaved }: { device: Device | null; onClose: () => void; onSaved: (d: Device) => void }) {
  const [value, setValue] = useState<BackupChoice>(DEFAULT_CHOICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (device) {
      setValue(device.backup);
      setError(null);
    }
  }, [device]);
  const save = async () => {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      onSaved((await patch<{ device: Device }>(`/api/devices/${device.id}`, { backup: value })).device);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!device}
      onClose={onClose}
      title={`What ${device?.name ?? 'this phone'} backs up`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!anyChoice(value)} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <BackupChoices value={value} onChange={setValue} />
        <Notice tone="info">After saving, the setup steps show what to change in the shortcut on the phone. Until then, the NAS skips anything you turned off.</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
