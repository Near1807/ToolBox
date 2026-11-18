// v0.43.0 (ADR 0049): the categories become objects. Two devices on v0.42
// (the same data, synchronised, plus something each made alone), each
// migrates ALONE (migration 7), then they synchronise: no category twice, no
// conflict, the same identifiers everywhere; no column of before rewritten.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { agendaV042 } from './agenda-v042';
import { devices, type Devices } from './harness';

const API = '/api/modules/agenda';
/**
 * The id a category gets from its name (ADR 0049), computed here on its own
 * (Node's SHA-1, RFC 9562 UUID v5): no import of the module's code.
 */
function categoryIdOf(name: string): string {
  const fold = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const ns = Buffer.from('6f1c2a4e9b3d4c578e210a5d7b9c3e14', 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(fold, 'utf8')]))
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** The columns v0.42 had, per table (what migration 7 must never rewrite). */
const BEFORE: Record<string, string[]> = {
  events: [
    'id',
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'start_at',
    'end_at',
    'all_day',
    'location',
    'note',
    'category',
    'timer_pref',
    'source_id',
    'origin_key',
    'origin',
    'optional',
    'done_at',
  ],
  categories: [
    'id',
    'created_at',
    'updated_at',
    'deleted_at',
    'key',
    'name',
    'color',
    'shape',
    'counted',
    'shown',
    'sort',
    'mine',
  ],
};
const md5 = (rows: Record<string, unknown>[], cols: string[]) =>
  createHash('md5')
    .update(JSON.stringify(rows.map((r) => cols.map((c) => r[c]))))
    .digest('hex');

describe('the categories of v0.42 become objects (each device alone, then a sync)', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  it('0 duplicate, 0 conflict, the same ids on both; nothing of before rewritten', async () => {
    const old = await agendaV042();
    d = await devices({ replace: { agenda: old } });
    d.first('replace');
    // Together (synchronised in v0.42): a course, a lower-case variant, a coloured category.
    await d.onPc('POST', `${API}/events`, {
      title: 'Thermo',
      start: '2026-11-18T08:15',
      end: '2026-11-18T10:00',
      category: 'Cours',
    });
    await d.onPc('POST', `${API}/events`, {
      title: 'Staff',
      start: '2026-11-18T12:00',
      end: '2026-11-18T13:00',
      category: 'réunions',
    });
    await d.onPc('POST', `${API}/events`, {
      title: 'Rendu',
      start: '2026-11-20T23:59',
      end: '2026-11-20T23:59',
      category: 'Deadline',
    });
    const colored = await d.onPc<{ id: string }>('POST', `${API}/categories`, {
      name: 'Cours',
      color: 'p:bleu',
    });
    d.exchange();
    // Each alone before the upgrade: the phone a « Foot », the PC a « Scouts ».
    await d.onPhone('POST', `${API}/events`, {
      title: 'Match',
      start: '2026-11-21T10:00',
      end: '2026-11-21T12:00',
      category: 'Foot',
    });
    await d.onPc('POST', `${API}/events`, {
      title: 'Réunion',
      start: '2026-11-22T14:00',
      end: '2026-11-22T17:00',
      category: 'Scouts',
    });
    const before = {
      pc: d.rows('pc', 'agenda'),
      phone: d.rows('phone', 'agenda'),
    };
    const pcDir = d.pc.dataDir;
    const phoneDb = d.phoneDb;
    await d.close({ keep: true });

    // v0.43.0 on both: migration 7, each alone.
    d = await devices({ pcDir, phoneDb });
    for (const side of ['pc', 'phone'] as const) {
      const after = d.rows(side, 'agenda');
      // Not one column of before rewritten (md5, per table).
      for (const t of ['events', 'categories'])
        expect(
          md5(
            after[t]!.filter((r) => before[side][t]!.some((b) => b.id === r.id)),
            BEFORE[t]!,
          ),
          `${side} ${t}`,
        ).toBe(md5(before[side][t]!, BEFORE[t]!));
      // The coloured one kept its id; the others: an id from their name.
      const cats = after.categories!;
      expect(cats.find((c) => c.name === 'Cours')!.id).toBe(colored.id);
      expect(cats.find((c) => c.name === 'Réunions')!.id).toBe(categoryIdOf('Réunions'));
      expect(cats.find((c) => c.name === 'Deadline')!.id).toBe(categoryIdOf('Deadline'));
      // Every event points to its category; the deadline got its type.
      for (const e of after.events!) expect(e.category_id, String(e.title)).toBeTruthy();
      expect(after.events!.find((e) => e.title === 'Rendu')!.kind).toBe('deadline');
      expect(after.events!.find((e) => e.title === 'Staff')!.category_id).toBe(
        categoryIdOf('Réunions'),
      );
    }
    const result = d.exchange();
    expect(Number(result.conflicts ?? 0)).toBe(0);
    expect(d.pcEngine.conflicts()).toEqual([]);
    expect(d.phoneEngine.conflicts()).toEqual([]);
    // No category twice, on either device; the same ids on both.
    for (const side of ['pc', 'phone'] as const) {
      const live = d.rows(side, 'agenda').categories!.filter((c) => c.deleted_at === null);
      const keys = live.map((c) => String(c.key));
      expect(new Set(keys).size, side).toBe(keys.length);
    }
    const ids = (side: 'pc' | 'phone') =>
      d
        .rows(side, 'agenda')
        .categories!.filter((c) => c.deleted_at === null)
        .map((c) => `${String(c.name)}=${String(c.id)}`)
        .sort();
    // The shared ones are the same; « Foot » (phone) and « Scouts » (PC) exist where their
    // events were migrated and are shown from their name elsewhere, with the same id.
    const pcIds = ids('pc');
    const phoneIds = ids('phone');
    for (const shared of pcIds.filter((x) => !/^(Foot|Scouts)=/.test(x)))
      expect(phoneIds).toContain(shared);
    // Read on both sides: the same list (names and ids), events and categories agree.
    const pcList = await d.onPc<{ id: string; name: string }[]>('GET', `${API}/categories`);
    const phoneList = await d.onPhone<{ id: string; name: string }[]>('GET', `${API}/categories`);
    expect(phoneList.map((c) => `${c.name}=${c.id}`).sort()).toEqual(
      pcList.map((c) => `${c.name}=${c.id}`).sort(),
    );
    expect(pcList.find((c) => c.name === 'Foot')!.id).toBe(categoryIdOf('Foot'));
    expect(phoneList.find((c) => c.name === 'Scouts')!.id).toBe(categoryIdOf('Scouts'));
    // A change after: a colour on « Foot » made on the PC (its row written with the same id).
    await d.onPc('PATCH', `${API}/categories/${categoryIdOf('Foot')}`, { color: 'p:vert' });
    const again = d.exchange();
    expect(Number(again.conflicts ?? 0)).toBe(0);
    const foot = (
      await d.onPhone<{ name: string; css: string }[]>('GET', `${API}/categories`)
    ).find((c) => c.name === 'Foot');
    expect(foot!.css).toBe('var(--hue-vert)');
  });
});
