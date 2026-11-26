// v0.46.0: the disk on a REAL volume — run by the Windows CI only, on a
// virtual NTFS disk it creates (COFFRE_TEST_VOLUME, e.g. « R: »), whose letter
// it then changes (COFFRE_TEST_VHD, diskpart): the Coffre's disk is found
// again by its identity on the new letter; copies, long paths, verification.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResetReport, UpdateReport } from '../shared/types';
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
  job as runJob,
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
    // v0.48.0: the tree moved (and a name whose case only changes) then the disk updated
    // by MOVES; an arborescence imported (long paths, node_modules left out).
    it(
      'arbre déplacé, casse changée : le disque suit par déplacements ; import d’une arborescence',
      { timeout: 180_000 },
      async () => {
        w = await diskWorld({ realVolumes: true });
        await deposit(w, { 'chap1.md': 'thermo' }, ['thermo']);
        await deposit(w, { 'vlan.md': 'réseaux' }, ['Réseaux']);
        await deposit(w, { 'cuda.md': 'gpu' }, ['GPU']);
        const s = await registerDisk(w, `${volume}\\Arbre`);
        const first = await waitJob(
          w,
          (await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`)).jobId,
        );
        expect(first.status, first.error ?? '').toBe('succeeded');
        const cours = await ok<{ id: string }>(w, 'POST', `${API}/folders`, { name: 'Cours' });
        const all = await ok<{ id: string; name: string }[]>(w, 'GET', `${API}/folders`);
        for (const name of ['thermo', 'Réseaux', 'GPU'])
          await runJob(w, 'POST', `${API}/folders/${all.find((c) => c.name === name)!.id}/move`, {
            parentId: cours.id,
          });
        await ok(w, 'PATCH', `${API}/folders/${all.find((c) => c.name === 'thermo')!.id}`, {
          name: 'Thermo',
        });
        const lib = path.join(w.hub.dataDir, 'coffre');
        expect(readdirSync(path.join(lib, 'Cours')).sort()).toEqual(['GPU', 'Réseaux', 'Thermo']);
        const plan = await ok<{ counts: { copy: number; move: number } }>(
          w,
          'GET',
          `${API}/disk/plan`,
        );
        expect(plan.counts).toMatchObject({ copy: 0, move: 3 });
        const second = await waitJob(
          w,
          (await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`)).jobId,
        );
        expect(second.status, second.error ?? '').toBe('succeeded');
        expect((second.result as UpdateReport).moved).toBe(3);
        expect((second.result as UpdateReport).copied).toBe(0);
        expect(readFileSync(path.join(s.root!, 'Cours', 'Thermo', 'chap1.md'), 'utf8')).toBe(
          'thermo',
        );
        expect(readdirSync(path.join(s.root!, 'Cours')).sort()).toEqual([
          'GPU',
          'Réseaux',
          'Thermo',
        ]);
        // An arborescence imported: long folder names, a node_modules left out.
        const src = path.join(w.dl, 'Programmation');
        const long = 'Un dossier au nom assez long pour tester les chemins';
        mkdirSync(path.join(src, long, long, 'site', 'node_modules', 'x'), { recursive: true });
        writeFileSync(path.join(src, long, long, 'notes.txt'), 'notes');
        writeFileSync(path.join(src, long, long, 'site', 'package.json'), '{}');
        writeFileSync(path.join(src, long, long, 'site', 'node_modules', 'x', 'i.js'), '1');
        const st = await ok<{ id: string }>(w, 'POST', `${API}/import/start`, { source: src });
        let state = '';
        for (let i = 0; i < 200 && state !== 'done'; i++) {
          await new Promise((r) => setTimeout(r, 100));
          state = (await ok<{ state: string }>(w, 'GET', `${API}/import/${st.id}`)).state;
        }
        expect(state).toBe('done');
        const site = path.join(lib, 'Programmation', long, long, 'site');
        expect(readFileSync(path.join(site, 'package.json'), 'utf8')).toBe('{}');
        expect(existsSync(path.join(site, 'node_modules'))).toBe(false);
      },
    );
    // v0.49.0: « Réinitialiser le Coffre » — nothing deleted on the disk: its folder is
    // renamed on the real volume, a new empty one registered, the next update works.
    it(
      'réinitialiser : le dossier du disque renommé sur le vrai volume, rien supprimé',
      { timeout: 180_000 },
      async () => {
        w = await diskWorld({ realVolumes: true });
        await deposit(w, { 'garde.md': 'à garder' }, ['Cours']);
        const s = await registerDisk(w, `${volume}\\Reinit`);
        expect((await runJob<UpdateReport>(w, 'POST', `${API}/disk/update`)).copied).toBe(1);
        const report = await runJob<ResetReport>(w, 'POST', `${API}/reset/apply`, {
          inventoryDir: mkdtempSync(path.join(tmpdir(), 'documents-')),
          confirm: 'vider',
          keepDisk: true,
        });
        expect(report.diskFolder).toMatch(/ToolBox-Coffre-ancien-\d{4}-\d{2}-\d{2}$/);
        expect(readFileSync(path.join(report.diskFolder!, 'Cours', 'garde.md'), 'utf8')).toBe(
          'à garder',
        );
        const again = await status(w);
        expect(again.connected).toBe(true);
        expect(again.root).toBe(s.root);
        await deposit(w, { 'neuf.md': 'neuf' }, ['Perso']);
        expect((await runJob<UpdateReport>(w, 'POST', `${API}/disk/update`)).copied).toBe(1);
        expect(readdirSync(s.root!)).toContain('Perso');
      },
    );
    it(
      'copie, chemin long, lettre changée : reconnu par l’identité ; vérifié',
      { timeout: 180_000 },
      async () => {
        w = await diskWorld({ realVolumes: true });
        const deep = Array.from(
          { length: 5 },
          (_, i) => `Dossier assez long numéro ${i} pour le chemin`,
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
