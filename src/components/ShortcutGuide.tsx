import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { BatteryCharging, Clock, PowerOff, Share, Wifi } from 'lucide-react';
import { formatDateTime } from '../lib/format.ts';
import type { BackupChoice } from '../lib/types.ts';
import { Button, CopyButton, CopyField, Notice } from './ui.tsx';

export interface GuideProps {
  serverName: string;
  deviceName: string;
  baseUrl: string;
  candidates?: string[];
  /** Only known right after creating the phone or issuing a new token. */
  token?: string | null;
  tokenHint?: string;
  limit: number;
  backup: BackupChoice;
  /** Shown after the phone's choices were edited: the shortcut on the phone has to be changed to match. */
  choicesChanged?: boolean;
  pairUrl?: string;
  pairExpiresAt?: string;
  onNewToken?: () => void;
}

function Code({ children }: { children: ReactNode }) {
  // Break long URLs and tokens anywhere, but never split a short word like "Authorization".
  return <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]">{children}</code>;
}

function Action({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-fg">{children}</span>;
}

/** A variable chip, styled like the blue variable tokens in the Shortcuts app. */
function Var({ children }: { children: ReactNode }) {
  return <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[0.85em] font-medium text-primary">{children}</span>;
}

function Step({ n, title, children }: { n: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{n}</span>
      <div className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1.5 flex flex-col gap-2 text-muted">{children}</div>}
      </div>
    </li>
  );
}

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Code>{value}</Code>
      <CopyButton text={value} />
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="list-none">
      <p className="mb-3 mt-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ol className="flex flex-col gap-4">{children}</ol>
    </li>
  );
}

/**
 * Find Photos filters for a phone's choices, besides the date filter. Filters in one Find Photos are joined
 * with "All", so "videos and screenshots but not photos" cannot be expressed; the NAS skips photos instead.
 */
function photoFilters(b: BackupChoice): { filters: ReactNode[]; nasSkips: string | null } {
  const image = (
    <>
      <Code>Media Type</Code> <Code>is</Code> <Code>Image</Code>
    </>
  );
  const noShots = (
    <>
      <Code>Is a Screenshot</Code> set to <Code>is not</Code> (some iOS versions list it as <Code>Is Not a Screenshot</Code>)
    </>
  );
  if (b.photos && b.videos && b.screenshots) return { filters: [], nasSkips: null };
  if (b.photos && b.videos) return { filters: [noShots], nasSkips: null };
  if (b.photos && b.screenshots) return { filters: [image], nasSkips: null };
  if (b.photos) return { filters: [image, noShots], nasSkips: null };
  if (b.videos && !b.screenshots)
    return {
      filters: [
        <>
          <Code>Media Type</Code> <Code>is</Code> <Code>Video</Code>
        </>,
      ],
      nasSkips: null,
    };
  if (b.screenshots && !b.videos)
    return {
      filters: [
        <>
          <Code>Is a Screenshot</Code> (set to <Code>is</Code>)
        </>,
      ],
      nasSkips: null,
    };
  return { filters: [], nasSkips: 'photos' };
}

/** How this phone's backup will look on the NAS. */
function FolderTree({ deviceName, backup }: { deviceName: string; backup: BackupChoice }) {
  const rows = [
    backup.photos && ['Photos', '2026/09/IMG_3001.HEIC'],
    backup.videos && ['Videos', '2026/09/IMG_3002.MOV'],
    backup.screenshots && ['Screenshots', '2026/09/IMG_3003.PNG'],
    backup.files && ['Files', 'Documents/Taxes/receipt.pdf'],
  ].filter(Boolean) as [string, string][];
  return (
    <pre className="overflow-x-auto rounded-xl bg-subtle p-3 font-mono text-xs leading-relaxed text-fg">
      {`My files/Phone Backup/\n└─ ${deviceName}/\n`}
      {rows.map(([top, rest], i) => (
        <span key={top}>
          {`   ${i === rows.length - 1 ? '└─' : '├─'} `}
          <b>{top}/</b>
          <span className="text-muted">{rest}</span>
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

export function ShortcutGuide(p: GuideProps) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!p.pairUrl) return setQr(null);
    QRCode.toDataURL(p.pairUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [p.pairUrl]);

  const b = p.backup;
  const media = b.photos || b.videos || b.screenshots;
  const { filters, nasSkips } = photoFilters(b);
  const auth = p.token ? `Bearer ${p.token}` : null;
  const shortcutName = `Back up to ${p.serverName}`;
  const isLocalOnly = /localhost|127\.0\.0\.1/.test(p.baseUrl);
  const authValue = auth ? <CopyLine value={auth} /> : <span>the word <Code>Bearer</Code>, a space, then this phone’s key{p.tokenHint ? ` (ends in …${p.tokenHint})` : ''}</span>;
  const headers = (
    <span>
      Tap the arrow for more options. Method: <Code>POST</Code>. Headers → Add new header: key <Code>Authorization</Code>, value <Var>Auth</Var>.
    </span>
  );
  const request = (path: string, method: 'GET' | 'POST', extra?: ReactNode) => (
    <>
      <span>
        URL: <Var>Server</Var> followed by <Code>{path}</Code> (tap the URL box, pick the Server variable, then type the rest).
      </span>
      <span>
        Tap the arrow for more options. Method: <Code>{method}</Code>. Headers → Add new header: key <Code>Authorization</Code>, value <Var>Auth</Var>.
      </span>
      {extra}
    </>
  );
  const what = [b.photos && 'photos', b.videos && 'videos', b.screenshots && 'screenshots', b.files && 'files from the folders you pick'].filter(Boolean).join(', ');

  let n = 0;
  const next = () => ++n;

  return (
    <div className="flex flex-col gap-5">
      {p.choicesChanged && (
        <Notice tone="warn" title="Now change the shortcut on the phone to match">
          The steps below show the new setup. Check the <b>Find Photos</b> filters{b.files ? ' and the Files steps' : ''}. Until the shortcut matches, the NAS simply skips anything that is turned off.
        </Notice>
      )}
      {isLocalOnly && (
        <Notice tone="warn" title="The phone cannot reach “localhost”">
          Set this computer’s network address under Admin → Settings → Address for phones{p.candidates?.length ? ` (for example ${p.candidates[0]})` : ''}.
        </Notice>
      )}

      <section className="flex flex-col gap-2">
        <p className="text-sm text-muted">
          This phone backs up <b className="text-fg">{what}</b>. On the NAS it gets its own folder, with everything sorted inside:
        </p>
        <FolderTree deviceName={p.deviceName} backup={b} />
      </section>

      {qr && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-subtle p-4 sm:flex-row">
          <img src={qr} alt="QR code that opens these steps on the phone" className="size-44 rounded-lg bg-white p-1" />
          <div className="text-sm leading-relaxed">
            <p className="font-semibold">Easiest: do this on the iPhone</p>
            <p className="mt-1 text-muted">
              Open the iPhone’s Camera and point it at this code. It opens these same steps on the phone, with copy buttons, so there is nothing to type. The code works until{' '}
              {p.pairExpiresAt ? formatDateTime(p.pairExpiresAt) : 'it expires'}.
            </p>
            {p.pairUrl && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <CopyButton text={p.pairUrl} label="Copy link instead" />
                <span className="text-xs text-muted">to AirDrop or message it to the phone</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3">
        <CopyField label="Server address" value={p.baseUrl} hint="The iPhone must be on the same Wi-Fi as the NAS." />
        {auth ? (
          <CopyField label="Phone key (the Auth value)" value={auth} secret hint="Treat it like a password. It only lets this phone upload into its own backup folder." />
        ) : (
          <Notice tone="info" action={p.onNewToken && <Button size="sm" onClick={p.onNewToken}>New token</Button>}>
            The key for {p.deviceName} {p.tokenHint ? `(ends in …${p.tokenHint}) ` : ''}was shown when the phone was added. To see a key again, choose <b>New token</b>. The old one then stops working.
          </Notice>
        )}
      </div>

      <Notice tone="ok" title="Another phone in the family already has the shortcut?">
        <span className="flex flex-col gap-2">
          <span>
            Skip the build. Get the shortcut shared from that phone (see “Adding the next phone” at the end), open it, and change only the <b>second Text action</b> to this phone’s key:
          </span>
          {authValue}
          <span>If this phone backs up different things, also adjust the Find Photos filters and the folders to match the steps below. Then do “Run it once” and “Make it automatic”.</span>
        </span>
      </Notice>

      <section>
        <h3 className="mb-3 font-semibold">Build the shortcut (first phone only, 5–10 minutes)</h3>
        <ol className="flex flex-col gap-5">
          <Part title="Start">
            <Step n={next()} title={<>Open <Action>Shortcuts</Action>, tap <Action>+</Action>, and name the new shortcut “{shortcutName}”.</>} />
            <Step n={next()} title={<>Add a <Action>Text</Action> action with the server address, then <Action>Set Variable</Action> named <Var>Server</Var></>}>
              <CopyLine value={p.baseUrl} />
              <span>Set Variable: name it <Code>Server</Code>, input <Code>Text</Code>.</span>
            </Step>
            <Step n={next()} title={<>Add a second <Action>Text</Action> action with this phone’s key, then <Action>Set Variable</Action> named <Var>Auth</Var></>}>
              {authValue}
              <span>
                Set Variable: name it <Code>Auth</Code>, input <Code>Text</Code>. This is the only place the key goes, so a new key later means changing just this one line.
              </span>
            </Step>
            <Step n={next()} title={<>Add <Action>Get Contents of URL</Action></>}>
              {request('/api/device/sync-state', 'GET')}
              <span>This tells the NAS a backup is starting. If the PC is off, the shortcut stops here and nothing else happens.</span>
            </Step>
          </Part>

          {media && (
            <Part title="Photos, videos and screenshots">
              <Step n={next()} title={<>Add <Action>Get Dictionary Value</Action></>}>
                <span>
                  Get <Code>Value</Code> for key <Code>since</Code> in <Code>Contents of URL</Code>.
                </span>
              </Step>
              <Step n={next()} title={<>Add <Action>Get Dates from Input</Action></>}>
                <span>
                  Input: <Code>Dictionary Value</Code>.
                </span>
              </Step>
              <Step n={next()} title={<>Add <Action>Find Photos</Action></>}>
                <span>
                  Add filter: <Code>Date Taken</Code> <Code>is after</Code> the <Code>Dates</Code> variable (tap the date, choose Select Variable). Older iOS versions call it <Code>Creation Date</Code>.
                </span>
                {filters.map((f, i) => (
                  <span key={i}>Add another filter: {f}.</span>
                ))}
                {filters.length > 0 && (
                  <span>
                    Keep <Code>All</Code> of the filters must be true.
                  </span>
                )}
                {nasSkips && <span>Leave out any media filter: the NAS skips the {nasSkips} for you.</span>}
                <span>
                  Sort by <Code>Date Taken</Code>, order <b className="text-fg">Oldest First</b>. Turn on Limit and set it to <Code>{p.limit}</Code>.
                </span>
                <Notice tone="warn">Oldest First matters. It lets an interrupted backup continue where it stopped. Newest first would make the NAS re-check the same photos every time.</Notice>
              </Step>
              <Step n={next()} title={<>Add <Action>Repeat with Each</Action> with input <Code>Photos</Code>. Inside the repeat, add:</>}>
                <ol className="flex flex-col gap-3 border-l-2 border-line pl-4">
                  <li>
                    <Action>Format Date</Action>: date <Code>Repeat Item → Date Taken</Code> (or Creation Date), format <Code>ISO 8601</Code>, turn on <b className="text-fg">Include ISO 8601 Time</b>.
                  </li>
                  <li className="flex flex-col gap-2">
                    <span>
                      <Action>Get Contents of URL</Action>:
                    </span>
                    {request(
                      '/api/device/upload',
                      'POST',
                      <span>
                        Request Body: <Code>Form</Code>. Add field <Code>file</Code> of type <b className="text-fg">File</b> = <Code>Repeat Item</Code>. Add field <Code>takenAt</Code> of type Text ={' '}
                        <Code>Formatted Date</Code>.
                      </span>,
                    )}
                  </li>
                </ol>
              </Step>
            </Part>
          )}

          {b.files && (
            <Part title="Files and folders (from the Files app)">
              <Step n={next()} title={<>Add a <Action>Text</Action> action with the folder’s name for the NAS, then <Action>Set Variable</Action> named <Var>Folder</Var></>}>
                <span>
                  For example <Code>Documents</Code>. This becomes <Code>Files/Documents</Code> on the NAS. A slash makes a subfolder: <Code>Work/Scans</Code>.
                </span>
                <span>Set Variable: name it <Code>Folder</Code>, input <Code>Text</Code>.</span>
              </Step>
              <Step n={next()} title={<>Add <Action>Get Contents of Folder</Action></>}>
                <span>Tap the folder field and pick the folder on the iPhone to back up (in iCloud Drive or On My iPhone).</span>
                <span>
                  Tap the arrow (Show More) and turn on <b className="text-fg">Recursive</b>, so files inside its subfolders come too.
                </span>
                <span>
                  Shortcuts cannot tell the NAS which subfolder a file was in, so they all land together in this folder. To keep a subfolder apart, add it as its own folder (for example <Code>Documents/Taxes</Code>).
                </span>
              </Step>
              <Step n={next()} title={<>Add <Action>Repeat with Each</Action> with input <Code>Contents of Folder</Code>. Inside the repeat, add:</>}>
                <ol className="flex flex-col gap-3 border-l-2 border-line pl-4">
                  <li>
                    <Action>Format Date</Action>: date <Code>Repeat Item → Creation Date</Code>, format <Code>ISO 8601</Code>, turn on <b className="text-fg">Include ISO 8601 Time</b>.
                  </li>
                  <li className="flex flex-col gap-2">
                    <span>
                      <Action>Get Contents of URL</Action>: URL <Var>Server</Var> followed by <Code>/api/device/file-check</Code>.
                    </span>
                    {headers}
                    <span>
                      Request Body: <Code>JSON</Code>. Add five <b className="text-fg">Text</b> fields:
                    </span>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>
                        <Code>folder</Code> = <Var>Folder</Var>
                      </li>
                      <li>
                        <Code>name</Code> = <Code>Repeat Item</Code>, then tap it and choose <Code>Name</Code>
                      </li>
                      <li>
                        <Code>created</Code> = <Code>Formatted Date</Code>
                      </li>
                      <li>
                        <Code>modified</Code> = <Code>Repeat Item</Code> → <Code>Last Modified Date</Code> (File Modification Date on some iOS versions)
                      </li>
                      <li>
                        <Code>size</Code> = <Code>Repeat Item</Code> → <Code>File Size</Code>
                      </li>
                    </ul>
                    <span>The NAS answers with an upload address only when the file is new or has changed since last time.</span>
                  </li>
                  <li>
                    <Action>Get Dictionary Value</Action>: key <Code>upload</Code> in <Code>Contents of URL</Code>.
                  </li>
                  <li className="flex flex-col gap-2">
                    <span>
                      <Action>If</Action> <Code>Dictionary Value</Code> <Code>has any value</Code>. Inside the If, add <Action>Get Contents of URL</Action>:
                    </span>
                    <span>
                      URL: only the <Code>Dictionary Value</Code> variable (it is the full upload address, so no Server in front).
                    </span>
                    {headers}
                    <span>
                      Request Body: <Code>Form</Code>. Add field <Code>file</Code> of type <b className="text-fg">File</b> = <Code>Repeat Item</Code>.
                    </span>
                    <span>Leave “Otherwise” empty.</span>
                  </li>
                </ol>
              </Step>
              <Step n={next()} title="More folders? Add the same three steps again for each one">
                <span>
                  A new <Action>Text</Action> with that folder’s name → <Action>Set Variable</Action> <Var>Folder</Var> → <Action>Get Contents of Folder</Action> → the same <Action>Repeat with Each</Action>. Tip: long-press an action → Duplicate
                  saves typing.
                </span>
              </Step>
            </Part>
          )}

          <Part title="Finish">
            <Step n={next()} title={<>After the last <Action>End Repeat</Action>, add <Action>Get Contents of URL</Action></>}>{request('/api/device/sync-complete', 'POST')}</Step>
            <Step n={next()} title="Optional: a notification when it finishes">
              <span>
                Add <Action>Get Dictionary Value</Action> for key <Code>message</Code>, then <Action>Show Notification</Action> with <Code>Dictionary Value</Code>.
              </span>
            </Step>
          </Part>
        </ol>
        <p className="mt-3 text-xs text-muted">Menu names can differ slightly between iOS versions.</p>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Run it once</h3>
        <p className="text-sm leading-relaxed text-muted">
          Tap ▶ with the phone unlocked. Allow access to {media ? 'Photos, ' : ''}
          {b.files ? 'the folders, ' : ''}and the NAS when iOS asks. The backup appears on the NAS in “Phone Backup/{p.deviceName}”, laid out as shown at the top.
        </p>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Make it automatic</h3>
        <p className="mb-3 text-sm text-muted">Once this is set, the phone backs up by itself. Nobody needs to open anything.</p>
        <ol className="flex flex-col gap-4">
          <Step n={<BatteryCharging className="size-4" aria-hidden />} title="Every time the phone starts charging">
            <span>
              Shortcuts → <Action>Automation</Action> → <Action>+</Action> → <Action>Charger</Action> → <Code>Is Connected</Code> → choose <b className="text-fg">Run Immediately</b> (turn off “Notify When Run” if you prefer) → pick “{shortcutName}”.
            </span>
            <span>It fires for a cable, a MagSafe charger and any wireless charger alike.</span>
          </Step>
          <Step n={<Wifi className="size-4" aria-hidden />} title="Only at home (recommended)">
            <span>
              At the very top of the shortcut, add <Action>Get Network Details</Action> (Wi-Fi, Network Name), then <Action>If</Action> Network Details <Code>is</Code> your home Wi-Fi name, and drag the other steps inside the If. Otherwise the phone shows an error whenever it charges
              away from home.
            </span>
          </Step>
          <Step n={<PowerOff className="size-4" aria-hidden />} title="When the PC is off">
            <span>
              Nothing is backed up and nothing is lost. The shortcut stops at its first request, and iOS may show a short “could not connect” notice. The next time the phone charges while the PC is on, it catches up on everything it missed.
            </span>
          </Step>
          <Step n={<Clock className="size-4" aria-hidden />} title="Optional: also every night">
            <span>
              A second automation: <Action>Time of Day</Action>, for example 3:00 AM daily, <b className="text-fg">Run Immediately</b>, same shortcut. It catches phones that sit on the charger all evening.
            </span>
          </Step>
        </ol>
      </section>

      <section className="rounded-2xl border border-line p-4">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Share className="size-4 text-primary" aria-hidden /> Adding the next phone
        </h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>
            On the NAS, whoever the phone belongs to signs in and chooses Phones → <b className="text-fg">Add phone</b>. The new phone gets its own key and its own folder.
          </li>
          <li>
            On this finished phone, open the shortcut and <b className="text-fg">temporarily replace the key</b> in the second Text action with <Code>Bearer PASTE-KEY-HERE</Code>, so your key does not travel with the copy.
          </li>
          <li>
            Long-press the shortcut → <Action>Share</Action> → <Action>Copy iCloud Link</Action> and send the link to the new phone. Then put your own key back.
          </li>
          <li>
            On the new phone, open the link → <Action>Add Shortcut</Action>, paste its key into that second Text action, pick its own folders in <Action>Get Contents of Folder</Action>, run it once, and add the charger automation.
          </li>
        </ol>
      </section>

      <section className="rounded-2xl bg-subtle p-4 text-sm leading-relaxed">
        <h3 className="mb-2 font-semibold">Good to know</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-muted">
          {media && (
            <li>Each run sends at most {p.limit} photos and videos, oldest first, and the next run continues from there. A large library catches up over several charges, or you can run the shortcut a few times by hand.</li>
          )}
          {media && <li>If the same photo arrives twice, the NAS recognises it and keeps only one copy.</li>}
          {media && (
            <li>
              To back up only some albums, add a filter <Code>Album</Code> <Code>is</Code> … to Find Photos.
            </li>
          )}
          {b.files && (
            <li>A file changed on the phone replaces its copy on the NAS; the previous version goes to the NAS trash. Files deleted on the phone stay on the NAS.</li>
          )}
          {media && <li>With “Optimize iPhone Storage” on, originals in iCloud have to download first, so runs are slower.</li>}
          {media && <li>Live Photos are saved as the still photo. Shortcuts cannot reach the motion part.</li>}
          <li>
            Shortcuts can reach Photos and the Files app, but not the data inside other apps (chats, app settings, Health). For those, keep iCloud Backup on, or make full backups with the Apple Devices app on
            the PC.
          </li>
          <li>Keep the NAS on and give it a fixed address in your router (a DHCP reservation). If its address changes, change only the first Text action.</li>
        </ul>
      </section>
    </div>
  );
}
