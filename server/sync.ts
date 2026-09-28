/**
 * Phone backup sync rules (iOS Shortcuts cannot hash files, so dedup-before-upload is impossible).
 *
 * The server keeps a per-device cursor: the newest "creation date" it has safely stored. The Shortcut asks
 * for it, finds photos created after it (oldest first, a batch at a time) and uploads them. Hash dedup on
 * the server is the safety net for the small overlap window, not the main mechanism.
 *
 * Rules that protect against losing photos:
 *  - The cursor only moves forward, and only to a photo whose successor arrived in ascending order (or at
 *    the end of a fully in-order run). An interrupted run resumes where it stopped, re-sending at most one.
 *  - The first photo of a run can never prove the order on its own, so it never moves the cursor by itself.
 *    That matters because a newest-first Shortcut would otherwise jump the cursor past every older photo.
 *  - If a run turns out to be out of order, the cursor snaps back to where it was when the run started, and
 *    the device is flagged so the UI can tell the user to sort "Oldest First".
 *  - A photo dated more than a day in the future (wrong camera clock) is stored but never moves the cursor.
 *  - The Shortcut is given cursor minus a few seconds, so bursts sharing a timestamp are never skipped.
 */

export const OVERLAP_MS = 5_000;
export const FUTURE_TOLERANCE_MS = 24 * 3600_000;
export const BEGINNING = '2000-01-01T00:00:00.000Z';

export interface ParsedDate {
  date: Date;
  /** Minutes east of UTC, when the text said so. */
  offsetMin: number | null;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parse the date a Shortcut sends. Recommended format is ISO 8601 ("Format Date → ISO 8601, include time"),
 * which carries the phone's UTC offset. Falls back to "yyyy-MM-dd HH:mm:ss" in the phone's known offset,
 * then to anything Date.parse understands ("Sep 24, 2026 at 2:30 PM").
 */
export function parseTakenAt(raw: unknown, fallbackOffsetMin: number | null): ParsedDate | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  const m = ISO_RE.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, sec, off] = m;
    const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, sec ? +sec : 0);
    let offsetMin: number | null = null;
    if (off) {
      offsetMin = off.toUpperCase() === 'Z' ? 0 : (off[0] === '-' ? -1 : 1) * (+off.slice(1, 3) * 60 + +off.slice(-2));
    }
    const assumed = offsetMin ?? fallbackOffsetMin ?? -new Date(wall).getTimezoneOffset();
    const date = new Date(wall - assumed * 60_000);
    return isNaN(date.getTime()) ? null : { date, offsetMin };
  }
  const loose = Date.parse(s.replace(/\s+at\s+/i, ' ').replace(/ /g, ' '));
  return isNaN(loose) ? null : { date: new Date(loose), offsetMin: null };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Wall-clock "yyyy-MM-dd HH:mm:ss" at a given UTC offset, the format "Get Dates from Input" reads reliably. */
export function formatWallClock(date: Date, offsetMin: number): string {
  const d = new Date(date.getTime() + offsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Year/month folder for a photo, in the phone's local time (a 00:30 on the 1st belongs to the new month). */
export function monthFolder(date: Date, offsetMin: number): { year: string; month: string } {
  const d = new Date(date.getTime() + offsetMin * 60_000);
  return { year: String(d.getUTCFullYear()), month: pad(d.getUTCMonth() + 1) };
}

export interface DeviceSyncState {
  cursor: string | null;
  tz_offset: number | null;
  /** Cursor value when the current run started; restored if the run proves to be out of order. */
  run_base: string | null;
  run_last: string | null;
  run_max: string | null;
  run_monotonic: number;
}

export function serverOffsetMin(at = new Date()): number {
  return -at.getTimezoneOffset();
}

/** What to tell the Shortcut: find photos created after this. */
export function sinceFor(dev: DeviceSyncState, now = new Date()): { since: string; sinceIso: string } {
  if (!dev.cursor) return { since: '2000-01-01 00:00:00', sinceIso: BEGINNING }; // "everything", in any time zone
  const since = new Date(Math.max(Date.parse(BEGINNING), Date.parse(dev.cursor) - OVERLAP_MS));
  const off = dev.tz_offset ?? serverOffsetMin(now);
  return { since: formatWallClock(since, off), sinceIso: since.toISOString() };
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Run state after one upload (stored or duplicate: either way the photo is safe on the NAS). */
export function afterUpload(dev: DeviceSyncState, takenAt: Date, now = new Date()): DeviceSyncState {
  const next = { ...dev };
  if (takenAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return next; // stored, but useless for ordering
  const t = takenAt.toISOString();
  if (next.run_monotonic && next.run_last && t < next.run_last) {
    next.run_monotonic = 0;
    next.cursor = next.run_base;
  }
  // The previous photo is now confirmed: this one arrived after it in ascending order.
  if (next.run_monotonic && next.run_last) next.cursor = later(next.cursor, next.run_last);
  next.run_last = t;
  next.run_max = later(next.run_max, t);
  return next;
}

export interface CompleteResult {
  state: DeviceSyncState;
  outOfOrder: boolean;
}

/** End of a run: an in-order run commits its newest photo; an out-of-order run leaves the cursor where it began. */
export function completeRun(dev: DeviceSyncState): CompleteResult {
  const state = { ...dev };
  if (state.run_monotonic) state.cursor = later(state.cursor, state.run_max);
  return { state, outOfOrder: !state.run_monotonic };
}

export function freshRun(dev: DeviceSyncState): DeviceSyncState {
  return { ...dev, run_base: dev.cursor, run_last: null, run_max: null, run_monotonic: 1 };
}
