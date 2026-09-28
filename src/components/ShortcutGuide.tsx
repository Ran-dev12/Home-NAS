import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { BatteryCharging, Clock, Share, Wifi } from 'lucide-react';
import { formatDateTime } from '../lib/format.ts';
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

export function ShortcutGuide(p: GuideProps) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!p.pairUrl) return setQr(null);
    QRCode.toDataURL(p.pairUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [p.pairUrl]);

  const auth = p.token ? `Bearer ${p.token}` : null;
  const shortcutName = `Back up to ${p.serverName}`;
  const isLocalOnly = /localhost|127\.0\.0\.1/.test(p.baseUrl);
  const authValue = auth ? <CopyLine value={auth} /> : <span>the word <Code>Bearer</Code>, a space, then this phone’s token{p.tokenHint ? ` (ends in …${p.tokenHint})` : ''}</span>;
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

  return (
    <div className="flex flex-col gap-5">
      {isLocalOnly && (
        <Notice tone="warn" title="The phone cannot reach “localhost”">
          Set this computer’s network address under Admin → Settings → Address for phones{p.candidates?.length ? ` (for example ${p.candidates[0]})` : ''}.
        </Notice>
      )}

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
          <span>Then do “Run it once” and “Make it automatic” below.</span>
        </span>
      </Notice>

      <section>
        <h3 className="mb-3 font-semibold">Build the shortcut (first phone only, about 5 minutes)</h3>
        <ol className="flex flex-col gap-4">
          <Step n={1} title={<>Open <Action>Shortcuts</Action>, tap <Action>+</Action>, and name the new shortcut “{shortcutName}”.</>} />
          <Step n={2} title={<>Add a <Action>Text</Action> action with the server address, then <Action>Set Variable</Action> named <Var>Server</Var></>}>
            <CopyLine value={p.baseUrl} />
            <span>Set Variable: name it <Code>Server</Code>, input <Code>Text</Code>.</span>
          </Step>
          <Step n={3} title={<>Add a second <Action>Text</Action> action with this phone’s key, then <Action>Set Variable</Action> named <Var>Auth</Var></>}>
            {authValue}
            <span>
              Set Variable: name it <Code>Auth</Code>, input <Code>Text</Code>. This is the only place the key goes, so a new key later means changing just this one line.
            </span>
          </Step>
          <Step n={4} title={<>Add <Action>Get Contents of URL</Action></>}>{request('/api/device/sync-state', 'GET')}</Step>
          <Step n={5} title={<>Add <Action>Get Dictionary Value</Action></>}>
            <span>
              Get <Code>Value</Code> for key <Code>since</Code> in <Code>Contents of URL</Code>.
            </span>
          </Step>
          <Step n={6} title={<>Add <Action>Get Dates from Input</Action></>}>
            <span>
              Input: <Code>Dictionary Value</Code>.
            </span>
          </Step>
          <Step n={7} title={<>Add <Action>Find Photos</Action></>}>
            <span>
              Add filter: <Code>Creation Date</Code> <Code>is after</Code> the <Code>Dates</Code> variable (tap the date, choose Select Variable).
            </span>
            <span>
              Sort by <Code>Creation Date</Code>, order <b className="text-fg">Oldest First</b>. Turn on Limit and set it to <Code>{p.limit}</Code>.
            </span>
            <Notice tone="warn">Oldest First matters. It lets an interrupted backup continue where it stopped. Newest first would make the NAS re-check the same photos every time.</Notice>
          </Step>
          <Step n={8} title={<>Add <Action>Repeat with Each</Action> with input <Code>Photos</Code>. Inside the repeat, add:</>}>
            <ol className="flex flex-col gap-3 border-l-2 border-line pl-4">
              <li>
                <Action>Format Date</Action>: date <Code>Repeat Item → Creation Date</Code>, format <Code>ISO 8601</Code>, turn on <b className="text-fg">Include ISO 8601 Time</b>.
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
          <Step n={9} title={<>After <Action>End Repeat</Action>, add <Action>Get Contents of URL</Action></>}>{request('/api/device/sync-complete', 'POST')}</Step>
          <Step n={10} title="Optional: a notification when it finishes">
            <span>
              Add <Action>Get Dictionary Value</Action> for key <Code>message</Code>, then <Action>Show Notification</Action> with <Code>Dictionary Value</Code>.
            </span>
          </Step>
        </ol>
        <p className="mt-3 text-xs text-muted">Menu names can differ slightly between iOS versions.</p>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Run it once</h3>
        <p className="text-sm leading-relaxed text-muted">
          Tap ▶ with the phone unlocked. Allow access to Photos and to the NAS when iOS asks. The photos appear on the NAS in “Phone Backup/{p.deviceName}”, sorted into year and month folders.
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
          </Step>
          <Step n={<Clock className="size-4" aria-hidden />} title="Optional: also every night">
            <span>
              A second automation: <Action>Time of Day</Action>, for example 3:00 AM daily, <b className="text-fg">Run Immediately</b>, same shortcut. It catches phones that sit on the charger all evening.
            </span>
          </Step>
          <Step n={<Wifi className="size-4" aria-hidden />} title="Only at home (recommended)">
            <span>
              At the very top of the shortcut, add <Action>Get Network Details</Action> (Wi-Fi, Network Name), then <Action>If</Action> Network Details <Code>is</Code> your home Wi-Fi name, and drag the other steps inside the If. Otherwise the phone shows an error whenever it charges
              away from home.
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
            On the new phone, open the link → <Action>Add Shortcut</Action>, paste its key into that second Text action, run it once, and add the charger automation.
          </li>
        </ol>
      </section>

      <section className="rounded-2xl bg-subtle p-4 text-sm leading-relaxed">
        <h3 className="mb-2 font-semibold">Good to know</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-muted">
          <li>Each run sends at most {p.limit} items, oldest first, and the next run continues from there. A large library catches up over several charges, or you can run the shortcut a few times by hand.</li>
          <li>If the same photo arrives twice, the NAS recognises it and keeps only one copy.</li>
          <li>With “Optimize iPhone Storage” on, originals in iCloud have to download first, so runs are slower.</li>
          <li>Live Photos are saved as the still photo. Shortcuts cannot reach the motion part.</li>
          <li>Keep the NAS on and give it a fixed address in your router (a DHCP reservation). If its address changes, change only the first Text action.</li>
        </ul>
      </section>
    </div>
  );
}
