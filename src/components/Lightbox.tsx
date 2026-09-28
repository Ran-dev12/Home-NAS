import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FolderOpen, Info, MapPin, X } from 'lucide-react';
import { formatBytes, formatDateTime, formatDuration } from '../lib/format.ts';
import type { MediaInfo } from '../lib/types.ts';
import { IconButton, Spinner, cx } from './ui.tsx';

export interface LightboxItem {
  key: string | number;
  name: string;
  kind: 'image' | 'video';
  takenAt?: string | null;
  mtime?: number;
  size?: number;
}

export function Lightbox<T extends LightboxItem>({
  items,
  index,
  onIndex,
  onClose,
  srcFor,
  downloadFor,
  infoFor,
  onShowInFolder,
}: {
  items: T[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  srcFor: (item: T) => string;
  downloadFor: (item: T) => string;
  infoFor?: (item: T) => Promise<MediaInfo>;
  onShowInFolder?: (item: T) => void;
}) {
  const item = items[index];
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);

  const prev = () => index > 0 && onIndex(index - 1);
  const next = () => index < items.length - 1 && onIndex(index + 1);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setInfo(null);
    // Warm the neighbours so swiping feels instant.
    for (const n of [items[index - 1], items[index + 1]]) if (n && n.kind === 'image') new Image().src = srcFor(n);
  }, [index, item?.key]);

  useEffect(() => {
    if (showInfo && infoFor && item) infoFor(item).then(setInfo).catch(() => setInfo(null));
  }, [showInfo, item?.key]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'i') setShowInfo((s) => !s);
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  });

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="fixed inset-0 z-[70] flex bg-black text-white"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (dx > 60) prev();
        else if (dx < -60) next();
      }}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="z-10 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 py-2">
          <IconButton label="Close" icon={X} ref={closeRef} onClick={onClose} className="text-white hover:bg-white/15 hover:text-white" />
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-medium">{item.name}</p>
            <p className="truncate text-xs text-white/70">
              {formatDateTime(item.takenAt ?? item.mtime)} · {index + 1} of {items.length}
            </p>
          </div>
          {onShowInFolder && <IconButton label="Show in folder" icon={FolderOpen} onClick={() => onShowInFolder(item)} className="text-white hover:bg-white/15 hover:text-white" />}
          {infoFor && <IconButton label="Details (i)" icon={Info} active={showInfo} onClick={() => setShowInfo(!showInfo)} className={cx(!showInfo && 'text-white hover:bg-white/15 hover:text-white')} />}
          <a href={downloadFor(item)} aria-label="Download original" title="Download original" className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/15">
            <Download className="size-5" aria-hidden />
          </a>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
          {item.kind === 'video' ? (
            failed ? (
              <PlaybackProblem href={downloadFor(item)} />
            ) : (
              <video key={item.key} src={srcFor(item)} controls autoPlay playsInline className="max-h-full max-w-full" onError={() => setFailed(true)} />
            )
          ) : failed ? (
            <PlaybackProblem href={downloadFor(item)} image />
          ) : (
            <>
              {!loaded && <Spinner className="absolute text-white" label="Loading photo" />}
              <img
                key={item.key}
                src={srcFor(item)}
                alt={item.name}
                className={cx('max-h-full max-w-full object-contain transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
              />
            </>
          )}
          {index > 0 && (
            <button
              type="button"
              aria-label="Previous"
              onClick={prev}
              className="absolute top-1/2 left-2 hidden size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 hover:bg-black/70 sm:flex"
            >
              <ChevronLeft className="size-7" aria-hidden />
            </button>
          )}
          {index < items.length - 1 && (
            <button
              type="button"
              aria-label="Next"
              onClick={next}
              className="absolute top-1/2 right-2 hidden size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 hover:bg-black/70 sm:flex"
            >
              <ChevronRight className="size-7" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {showInfo && infoFor && (
        <aside className="absolute inset-x-0 bottom-0 max-h-[50dvh] overflow-y-auto border-t border-white/10 bg-neutral-900 p-4 text-sm sm:static sm:max-h-none sm:w-80 sm:border-t-0 sm:border-l">
          <h2 className="mb-3 font-semibold">Details</h2>
          {!info ? (
            <Spinner className="text-white" />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-white/60">Taken</dt>
              <dd>{formatDateTime(info.takenAt ?? info.mtime)}</dd>
              {info.camera && (
                <>
                  <dt className="text-white/60">Camera</dt>
                  <dd>{info.camera}</dd>
                </>
              )}
              {info.width && info.height && (
                <>
                  <dt className="text-white/60">Size</dt>
                  <dd>
                    {info.width} × {info.height}
                    {info.width * info.height > 1e6 && ` · ${((info.width * info.height) / 1e6).toFixed(1)} MP`}
                  </dd>
                </>
              )}
              {info.duration && (
                <>
                  <dt className="text-white/60">Length</dt>
                  <dd>{formatDuration(info.duration)}</dd>
                </>
              )}
              <dt className="text-white/60">File</dt>
              <dd className="break-all">
                {info.name} · {formatBytes(info.size)}
              </dd>
              <dt className="text-white/60">Folder</dt>
              <dd className="font-mono text-xs break-all">{info.path.slice(0, info.path.lastIndexOf('/')) || '/'}</dd>
              {info.lat !== null && info.lon !== null && (
                <>
                  <dt className="text-white/60">Place</dt>
                  <dd>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${info.lat}&mlon=${info.lon}#map=15/${info.lat}/${info.lon}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-blue-300 hover:underline"
                    >
                      <MapPin className="size-4" aria-hidden /> Open map
                    </a>
                  </dd>
                </>
              )}
            </dl>
          )}
        </aside>
      )}
    </div>
  );
}

function PlaybackProblem({ href, image }: { href: string; image?: boolean }) {
  return (
    <div className="max-w-sm text-center">
      <p className="font-medium">{image ? 'This photo cannot be shown here' : 'This browser cannot play this video'}</p>
      <p className="mt-2 text-sm text-white/70">
        {image
          ? 'The format is not supported for preview. The original is safe on the NAS.'
          : 'iPhone videos are usually HEVC. Safari and Edge (with the HEVC extension) can play them; Chrome and Firefox often cannot.'}
      </p>
      <a href={href} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black">
        <Download className="size-4" aria-hidden /> Download original
      </a>
    </div>
  );
}
