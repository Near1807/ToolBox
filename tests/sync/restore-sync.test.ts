// v0.47.0 (ADR 0063): the PC restored to an older base, then synchronised with
// the phone. The PC stays the master; the phone's changes made after the copy
// come back to the PC, without duplicates nor losses; a change of the PC made
// after the restore reaches the phone (the PC's journal numbering continues
// after what the phone has seen).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { devices, type Devices } from './harness';

const IDEAS = '/api/modules/ideas';
interface Idea {
  id: string;
  title: string;
}
const titles = (list: { ideas: Idea[] }) => list.ideas.map((i) => i.title).sort();

describe('synchro après une restauration du PC', () => {
  let d: Devices | null = null;
  afterEach(async () => {
    await d?.close();
    d = null;
  });

  it('les changements plus récents du téléphone reviennent ; ceux du PC après restauration partent ; sans doublon', async () => {
    d = await devices();
    d.first('replace');
    await d.onPc('POST', `${IDEAS}/ideas`, { title: 'Avant la copie (PC)', tags: [] });
    await d.onPhone('POST', `${IDEAS}/ideas`, { title: 'Avant la copie (téléphone)', tags: [] });
    d.exchange();
    // The copy (a backup of the PC).
    const copy = path.join(mkdtempSync(path.join(tmpdir(), 'copie-')), 'hub.db');
    (d.pc.hub as unknown as { handle: { db: import('better-sqlite3').Database } }).handle.db
      .prepare('VACUUM INTO ?')
      .run(copy);
    // Life goes on, on both, synchronised many times (the numbering moves on).
    for (let i = 0; i < 5; i++) {
      await d.onPc('POST', `${IDEAS}/ideas`, { title: `Après la copie (PC) ${i}`, tags: [] });
      d.exchange();
    }
    const phoneIdea = await d.onPhone<Idea>('POST', `${IDEAS}/ideas`, {
      title: 'Après la copie (téléphone)',
      tags: [],
    });
    d.exchange();
    // Thomas restores the PC from the copy (confirmed), then restarts ToolBox.
    await d.onPc('POST', '/api/core/restore/stage', { file: copy, confirm: true });
    // A change of the phone made while the PC was being restored (not seen by the PC yet).
    await d.onPhone('PATCH', `${IDEAS}/ideas/${phoneIdea.id}`, {
      title: 'Après la copie (téléphone, modifiée)',
    });
    const pcDir = d.pc.dataDir;
    const phoneDb = d.phoneDb;
    await d.close({ keep: true });
    d = await devices({ pcDir, phoneDb });
    // The restored PC: only what the copy held.
    expect(titles(await d.onPc('GET', `${IDEAS}/ideas`))).toEqual([
      'Avant la copie (PC)',
      'Avant la copie (téléphone)',
    ]);
    // A change on the PC after the restore.
    await d.onPc('POST', `${IDEAS}/ideas`, { title: 'Après la restauration (PC)', tags: [] });
    // The PC asks for a first synchronisation again (the phone stops and shows its preview).
    const pcDb = (d.pc.hub as unknown as { handle: { db: import('better-sqlite3').Database } })
      .handle.db;
    const peers = pcDb.prepare('SELECT first_sync_at FROM core__sync_peers').all() as {
      first_sync_at: string | null;
    }[];
    expect(peers.every((p) => p.first_sync_at === null)).toBe(true);
    expect(
      pcDb
        .prepare('SELECT COUNT(*) FROM core__sync_cursors WHERE sent_seq > 0 OR received_seq > 0')
        .pluck()
        .get(),
    ).toBe(0);
    // Thomas chooses « Fusionner » in its preview; then the usual exchanges.
    d.first('merge');
    await d.onPhone('POST', `${IDEAS}/ideas`, { title: 'Ensuite (téléphone)', tags: [] });
    d.exchange();
    const pc = titles(await d.onPc('GET', `${IDEAS}/ideas`));
    const phone = titles(await d.onPhone('GET', `${IDEAS}/ideas`));
    // The phone still had everything: it brings back to the PC what the copy did not hold.
    expect(pc).toEqual([
      'Après la copie (PC) 0',
      'Après la copie (PC) 1',
      'Après la copie (PC) 2',
      'Après la copie (PC) 3',
      'Après la copie (PC) 4',
      'Après la copie (téléphone, modifiée)',
      'Après la restauration (PC)',
      'Avant la copie (PC)',
      'Avant la copie (téléphone)',
      'Ensuite (téléphone)',
    ]);
    expect(phone).toEqual(pc);
    // No duplicate rows on either side.
    for (const side of ['pc', 'phone'] as const) {
      const rows = d.rows(side, 'ideas').ideas!;
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    }
  });
});
