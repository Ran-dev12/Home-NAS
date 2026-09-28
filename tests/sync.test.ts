import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterUpload, completeRun, formatWallClock, freshRun, monthFolder, parseTakenAt, sinceFor, type DeviceSyncState } from '../server/sync.ts';

const base: DeviceSyncState = { cursor: null, tz_offset: 330, run_base: null, run_last: null, run_max: null, run_monotonic: 1 };
const t = (s: string) => new Date(s);
const NOW = t('2026-09-25T12:00:00Z');

function run(state: DeviceSyncState, dates: string[], complete = true) {
  let s = freshRun(state);
  for (const d of dates) s = afterUpload(s, t(d), NOW);
  return complete ? completeRun(s) : { state: s, outOfOrder: !s.run_monotonic };
}

test('oldest-first run commits the newest photo', () => {
  const { state, outOfOrder } = run(base, ['2026-09-20T10:00:00Z', '2026-09-21T10:00:00Z', '2026-09-22T10:00:00Z']);
  assert.equal(outOfOrder, false);
  assert.equal(state.cursor, '2026-09-22T10:00:00.000Z');
});

test('an interrupted run resumes from the last confirmed photo (at most one re-sent)', () => {
  const { state } = run(base, ['2026-09-20T10:00:00Z', '2026-09-21T10:00:00Z', '2026-09-22T10:00:00Z'], false);
  assert.equal(state.cursor, '2026-09-21T10:00:00.000Z');
});

test('the first photo of a run never moves the cursor on its own', () => {
  const { state } = run(base, ['2026-09-22T10:00:00Z'], false);
  assert.equal(state.cursor, null);
});

test('newest-first run never moves the cursor, so older photos are not skipped', () => {
  const start = { ...base, cursor: '2026-09-01T00:00:00.000Z' };
  const { state, outOfOrder } = run(start, ['2026-09-22T10:00:00Z', '2026-09-21T10:00:00Z', '2026-09-20T10:00:00Z']);
  assert.equal(outOfOrder, true);
  assert.equal(state.cursor, '2026-09-01T00:00:00.000Z');
});

test('a run that starts in order then breaks order snaps back to where it began', () => {
  const start = { ...base, cursor: '2026-09-01T00:00:00.000Z' };
  const { state, outOfOrder } = run(start, ['2026-09-10T00:00:00Z', '2026-09-20T00:00:00Z', '2026-09-25T00:00:00Z', '2026-09-15T00:00:00Z']);
  assert.equal(outOfOrder, true);
  assert.equal(state.cursor, '2026-09-01T00:00:00.000Z');
});

test('a photo with a wrong clock in the future does not move the cursor', () => {
  const { state } = run(base, ['2026-09-20T10:00:00Z', '2026-09-21T10:00:00Z', '2031-01-01T00:00:00Z']);
  assert.equal(state.cursor, '2026-09-21T10:00:00.000Z');
});

test('overlap items at the start of a run (already stored) do not break ordering', () => {
  const start = { ...base, cursor: '2026-09-21T10:00:00.000Z' };
  const { state, outOfOrder } = run(start, ['2026-09-21T09:59:58Z', '2026-09-21T10:00:00Z', '2026-09-23T08:00:00Z']);
  assert.equal(outOfOrder, false);
  assert.equal(state.cursor, '2026-09-23T08:00:00.000Z');
});

test('since = cursor minus overlap, as phone wall-clock time', () => {
  const s = sinceFor({ ...base, cursor: '2026-09-24T09:00:05.000Z', tz_offset: 330 });
  assert.equal(s.since, '2026-09-24 14:30:00'); // 09:00:05Z - 5s, shown at +05:30
  assert.equal(s.sinceIso, '2026-09-24T09:00:00.000Z');
  assert.equal(sinceFor(base).since.slice(0, 10), '2000-01-01');
});

test('parseTakenAt handles the formats Shortcuts produces', () => {
  const iso = parseTakenAt('2026-09-24T14:30:05+05:30', null)!;
  assert.equal(iso.date.toISOString(), '2026-09-24T09:00:05.000Z');
  assert.equal(iso.offsetMin, 330);
  assert.equal(parseTakenAt('2026-09-24T14:30:05+0530', null)!.date.toISOString(), '2026-09-24T09:00:05.000Z');
  assert.equal(parseTakenAt('2026-09-24T09:00:05Z', null)!.offsetMin, 0);
  // No offset in the text: use the phone's learned offset.
  assert.equal(parseTakenAt('2026-09-24 14:30:05', 330)!.date.toISOString(), '2026-09-24T09:00:05.000Z');
  assert.ok(parseTakenAt('Sep 24, 2026 at 2:30 PM', null));
  assert.equal(parseTakenAt('not a date', null), null);
  assert.equal(parseTakenAt('', null), null);
});

test('month folder follows the phone clock, not UTC', () => {
  // 00:30 on 1 Oct in India is still 30 Sep in UTC.
  assert.deepEqual(monthFolder(t('2026-09-30T19:00:00Z'), 330), { year: '2026', month: '10' });
  assert.equal(formatWallClock(t('2026-09-30T19:00:00Z'), 330), '2026-10-01 00:30:00');
});
