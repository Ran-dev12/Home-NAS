import { useEffect, useState } from 'react';
import { Server } from 'lucide-react';
import { get } from '../lib/api.ts';
import { Notice, Spinner } from '../components/ui.tsx';
import { ShortcutGuide } from '../components/ShortcutGuide.tsx';

interface Pairing {
  deviceName: string;
  token: string;
  batchLimit: number;
  serverName: string;
  baseUrl: string;
  expiresAt: string;
}

/** Opened on the iPhone from the QR code: the same steps, with the token ready to copy. */
export function PairPage({ code }: { code: string }) {
  const [p, setP] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<Pairing>(`/api/pair/${encodeURIComponent(code)}`)
      .then((x) => {
        setP(x);
        document.title = `Set up ${x.deviceName}`;
      })
      .catch((e) => setError(e.message));
  }, [code]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary-solid text-primary-fg">
          <Server className="size-6" aria-hidden />
        </div>
        <div>
          <h1 className="text-lg font-semibold">{p ? `Back up ${p.deviceName}` : 'Phone setup'}</h1>
          <p className="text-sm text-muted">{p ? `to ${p.serverName}` : 'HomeNAS'}</p>
        </div>
      </div>
      {error ? (
        <Notice tone="danger" title="This setup link does not work any more">
          {error}
        </Notice>
      ) : !p ? (
        <Spinner />
      ) : (
        <>
          <Notice tone="info">Keep this page open in Safari and switch between it and Shortcuts, copying each value as you go.</Notice>
          <div className="mt-5">
            <ShortcutGuide serverName={p.serverName} deviceName={p.deviceName} baseUrl={p.baseUrl} token={p.token} limit={p.batchLimit} />
          </div>
        </>
      )}
    </div>
  );
}
