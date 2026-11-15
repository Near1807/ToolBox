// A batch received from the other device is checked as a whole before
// anything is written (ADR 0044): a change of a table outside the
// synchronised list, an unknown column, a base column, a setting that is not
// shared, an unknown module or a batch of another device makes the WHOLE
// batch refused — even its genuine changes are not applied.
import { afterEach, describe, expect, it } from 'vitest';
import { SyncError, type Batch, type WireChange } from '../../backend/core/sync/engine';
import { beginExchange } from '../../backend/core/sync/protocol';
import { devices, type Devices } from './harness';

const TODO = '/api/modules/todo';

describe('synchronisation: a forged batch is refused, nothing written', () => {
  let d: Devices;
  afterEach(async () => d?.close());

  const genuine = async () => {
    d = await devices();
    d.first('merge');
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'Appeler Paul', tags: [] });
    const request = JSON.parse(JSON.stringify(beginExchange(d.phoneEngine, d.pcEngine.device)));
    const batch = request.batch as Batch;
    expect(batch.changes.length).toBeGreaterThan(0);
    return batch;
  };
  const forge = (batch: Batch, patch: Partial<WireChange>): Batch => ({
    ...batch,
    changes: [...batch.changes, { ...batch.changes[0]!, id: crypto.randomUUID(), ...patch }],
  });
  const pcTitles = () => d.rows('pc', 'todo').tasks!.map((t) => t.title);

  const cases: [string, (b: Batch) => Batch, RegExp][] = [
    ['a table outside the list (archive)', (b) => forge(b, { entity: 'tasks_v1' }), /table/],
    [
      'an unknown column',
      (b) => forge(b, { data: { ...b.changes[0]!.data, is_admin: 1 } }),
      /colonne is_admin/,
    ],
    [
      'a base column',
      (b) => forge(b, { data: { ...b.changes[0]!.data, id: 'other' } }),
      /colonne id/,
    ],
    ['an unknown module', (b) => forge(b, { scope: 'music-library' }), /module non synchronisé/],
    [
      'a setting that is not shared',
      (b) =>
        forge(b, {
          scope: 'core',
          entity: 'settings',
          op: 'set',
          entity_id: 'core',
          data: { outputRoot: 'C:/ailleurs' },
        }),
      /réglage/,
    ],
    ['a SQL name', (b) => forge(b, { entity: 'tasks; DROP TABLE todo__tasks' }), /table/],
  ];
  for (const [what, make, message] of cases)
    it(what, async () => {
      const batch = await genuine();
      const before = pcTitles();
      expect(() => d.pcEngine.applyBatch(d.phoneEngine.device, make(batch), {})).toThrow(SyncError);
      expect(() => d.pcEngine.applyBatch(d.phoneEngine.device, make(batch), {})).toThrow(message);
      // Not even the genuine change of the batch.
      expect(pcTitles()).toEqual(before);
      expect(pcTitles()).not.toContain('Appeler Paul');
    });

  it('a batch of another device', async () => {
    const batch = await genuine();
    expect(() => d.pcEngine.applyBatch('another-device', batch, {})).toThrow(/autre appareil/);
    expect(pcTitles()).not.toContain('Appeler Paul');
    // The genuine batch, untouched, is applied.
    d.pcEngine.applyBatch(d.phoneEngine.device, batch, {});
    expect(pcTitles()).toContain('Appeler Paul');
  });
});
