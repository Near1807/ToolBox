// The phone's safety net: one copy a day at opening (never of an empty base),
// the 7 newest kept, a restore OFFERED when the base is absent or empty and a
// copy with data exists — never automatic.
import { describe, expect, it } from 'vitest';
import {
  copiesToDelete,
  copyFileName,
  KEEP_COPIES,
  localDay,
  needsDailyCopy,
  restoreOffer,
  type BackupCopy,
} from '../../packages/phone/backup';

const copy = (day: string, rows = 10, hour = '08'): BackupCopy => ({
  file: copyFileName(`${day}T${hour}:00:00.000Z`),
  createdAt: `${day}T${hour}:00:00.000Z`,
  day,
  tasks: rows,
  rows,
  appVersion: '0.30.0',
  reason: 'quotidienne',
});
const full = { absent: false, rows: 12 };

describe('phone safety net', () => {
  it('one copy a day: taken when none today, not twice the same day', () => {
    expect(needsDailyCopy([], '2026-11-06', full)).toBe(true);
    expect(needsDailyCopy([copy('2026-11-05')], '2026-11-06', full)).toBe(true);
    expect(needsDailyCopy([copy('2026-11-06')], '2026-11-06', full)).toBe(false);
  });

  it('never a copy of an absent or empty base (the good copies are not pushed out)', () => {
    expect(needsDailyCopy([copy('2026-11-01')], '2026-11-06', { absent: true, rows: 0 })).toBe(
      false,
    );
    expect(needsDailyCopy([], '2026-11-06', { absent: false, rows: 0 })).toBe(false);
  });

  it('the 7 newest are kept, the older ones deleted', () => {
    expect(KEEP_COPIES).toBe(7);
    const copies = Array.from({ length: 10 }, (_, i) =>
      copy(`2026-11-${String(i + 1).padStart(2, '0')}`),
    );
    const deleted = copiesToDelete(copies).map((c) => c.day);
    expect(deleted).toEqual(['2026-11-03', '2026-11-02', '2026-11-01']);
    expect(copiesToDelete(copies.slice(0, 7))).toEqual([]);
  });

  it('restore offered only when the base is absent or empty AND a copy with data exists', () => {
    const copies = [copy('2026-11-04'), copy('2026-11-05', 0), copy('2026-11-03')];
    // Full base: nothing offered.
    expect(restoreOffer(copies, full)).toBeNull();
    // Absent or empty: the newest copy WITH data (the empty one is skipped).
    expect(restoreOffer(copies, { absent: true, rows: 0 })?.day).toBe('2026-11-04');
    expect(restoreOffer(copies, { absent: false, rows: 0 })?.day).toBe('2026-11-04');
    // No copy (or only empty ones): nothing to offer.
    expect(restoreOffer([], { absent: true, rows: 0 })).toBeNull();
    expect(restoreOffer([copy('2026-11-05', 0)], { absent: true, rows: 0 })).toBeNull();
  });

  it('local day and file names', () => {
    expect(localDay(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
    expect(copyFileName('2026-11-05T10:00:00.000Z')).toBe(
      'toolbox-2026-11-05T10-00-00-000Z.sqlite3',
    );
  });
});
