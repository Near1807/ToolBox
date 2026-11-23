// v0.46.0: the disk on a REAL volume — run by the Windows CI only, on a
// virtual NTFS disk it creates (COFFRE_TEST_VOLUME, e.g. « R: »), whose letter
// it then changes (COFFRE_TEST_VHD, diskpart): the Coffre's disk is found
// again by its identity on the new letter; copies, long paths, verification.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UpdateReport } from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  ok,
  registerDisk,
  sha,
  status,
  waitJob,
  type DiskWorld,
} from './disk-helpers';

const volume = process.env.COFFRE_TEST_VOLUME;
const vhd = process.env.COFFRE_TEST_VHD;

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

/** diskpart: the volume on `from` takes the letter `to`. */
function changeLetter(from: string, to: string) {
  const script = path.join(tmpdir(), `coffre-lettre-${Date.now()}.txt`);
  writeFileSync(
    script,
    [`select volume ${from[0]}`, `remove letter=${from[0]}`, `assign letter=${to[0]}`, ''].join(
      '\r\n',
    ),
  );
  execFileSync('diskpart', ['/s', script], { stdio: 'pipe' });
}

describe.runIf(process.platform === 'win32' && volume && vhd)(
  'vrai volume NTFS (CI Windows)',
  () => {
    it(
      'copie, chemin long, lettre changée : reconnu par l’identité ; vérifié',
      { timeout: 180_000 },
      async () => {
        w = await diskWorld({ realVolumes: true });
        const deep = Array.from(
          { length: 5 },
          (_, i) => `Contexte assez long numéro ${i} pour le chemin`,
        );
        const [doc] = await deposit(
          w,
          { [`${'n'.repeat(90)}.txt`]: 'long', 'cours.pdf': '%PDF réel' },
          deep,
        );
        const s = await registerDisk(w, `${volume}\\Sauvegardes`);
        expect(s.root).toBe(`${volume}\\Sauvegardes\\ToolBox-Coffre`);
        const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`);
        const job = await waitJob(w, jobId);
        expect(job.status, job.error ?? '').toBe('succeeded');
        expect((job.result as UpdateReport).copied).toBe(2);
        const onDisk = path.join(s.root!, ...deep, `${'n'.repeat(90)}.txt`);
        expect(onDisk.length).toBeGreaterThan(260);
        expect(readFileSync(onDisk, 'utf8')).toBe('long');
        // The letter changes (R: → S:): found again by its identity.
        const other = volume === 'S:' ? 'T:' : 'S:';
        changeLetter(volume!, other);
        let back = await status(w);
        for (let i = 0; i < 20 && back.root !== `${other}\\Sauvegardes\\ToolBox-Coffre`; i++) {
          await new Promise((r) => setTimeout(r, 500));
          back = await status(w);
        }
        expect(back.connected).toBe(true);
        expect(back.root).toBe(`${other}\\Sauvegardes\\ToolBox-Coffre`);
        expect(back.disk!.id).toBe(s.disk!.id);
        const verify = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/verify`);
        const v = await waitJob(w, verify.jobId);
        expect(v.status).toBe('succeeded');
        expect((v.result as { problems: unknown[] }).problems).toEqual([]);
        expect(sha(path.join(back.root!, ...deep, 'cours.pdf'))).toBe(
          sha(path.join(w.hub.dataDir, 'coffre', ...deep, 'cours.pdf')),
        );
        void doc;
      },
    );
  },
);
