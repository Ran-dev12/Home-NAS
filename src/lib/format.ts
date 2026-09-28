export function formatBytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(digits)} ${units[i]}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDate(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function monthLabel(ts: number): string {
  return monthFmt.format(new Date(ts));
}

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function timeAgo(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return 'never';
  const t = new Date(v).getTime();
  if (isNaN(t)) return 'never';
  const s = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return formatDate(t);
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function plural(n: number, word: string, many = word + 's'): string {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`;
}
