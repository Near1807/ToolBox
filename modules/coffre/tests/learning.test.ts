// v0.47.0 E: what the Coffre learns — site → context, a word of the name →
// context, an extension in a context → nature; the confidence rises when a
// rule is confirmed and falls when it is corrected; deleted, « Tout oublier »
// (confirmed); a value Thomas chose is never replaced.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRules, contextFromRules, placeWords, type LearnedRule } from '../shared/learn';
import type { ItemDto, LearnedRuleDto, ProposalDto } from '../shared/types';
import {
  API,
  analyze as analyzeTask,
  deposit,
  diskWorld,
  job,
  ok,
  type DiskWorld,
} from './disk-helpers';

const rule = (o: Partial<LearnedRule>): LearnedRule => ({
  id: 'r',
  kind: 'site',
  key: 'moodle.ecam.be',
  value: 'ctx-res',
  hits: 3,
  misses: 0,
  ...o,
});
const label = (id: string) =>
  id === 'ctx-res' ? 'Cours › Réseaux' : id === 'ctx-th' ? 'Cours › Thermo' : null;

describe('règles apprises (pures)', () => {
  it('mots du nom : ni années, ni nombres, ni mots vides', () => {
    expect(placeWords('TD3 Réseaux labo VLAN copie 2026 final.pdf')).toEqual([
      'td3',
      'reseaux',
      'labo',
      'vlan',
    ]);
  });

  it('propose seulement une règle sûre (2 confirmations, 2 sur 3 justes), avec sa raison', () => {
    expect(
      contextFromRules([rule({ hits: 1 })], { name: 'x.pdf', site: 'moodle.ecam.be' }, label),
    ).toBeNull();
    expect(
      contextFromRules(
        [rule({ hits: 2, misses: 2 })],
        { name: 'x.pdf', site: 'moodle.ecam.be' },
        label,
      ),
    ).toBeNull();
    expect(contextFromRules([rule({})], { name: 'x.pdf', site: 'moodle.ecam.be' }, label)).toEqual({
      contextId: 'ctx-res',
      reason: '3 fichiers de ce site rangés dans « Cours › Réseaux » (appris)',
    });
    // A rule towards a context that no longer exists: nothing.
    expect(
      contextFromRules([rule({ value: 'gone' })], { name: 'x', site: 'moodle.ecam.be' }, label),
    ).toBeNull();
  });

  it('une valeur choisie n’est jamais remplacée', () => {
    const proposal: Pick<ProposalDto, 'context' | 'attributes'> = {
      context: null,
      attributes: [{ key: 'nature', value: 'rapport', origin: 'chosen', reason: null }],
    };
    const out = applyRules(
      proposal,
      [rule({}), rule({ id: 'n', kind: 'ext', key: 'ctx-res:pdf', value: 'synthèse' })],
      { name: 'x.pdf', site: 'moodle.ecam.be', ext: 'pdf' },
      (id) => label(id)?.split(' › ') ?? null,
    );
    expect(out.context).toMatchObject({ kind: 'existing', id: 'ctx-res' });
    expect(out.attributes).toEqual(proposal.attributes);
  });
});

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

/** A file « downloaded » from a site (its Mark of the Web, simulated beside it). */
function downloaded(name: string, site: string) {
  const p = path.join(w.dl, name);
  writeFileSync(p, `${name} ${Math.random()}`);
  writeFileSync(
    `${p}:Zone.Identifier`,
    `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://${site}/f/${name}\r\n`,
  );
  return p;
}
const analyze = (p: string) => analyzeTask(w, { paths: [p] }).then((r) => r[0]!);
const put = (p: string, contextId: string, attributes: ProposalDto['attributes'] = []) =>
  job<{ created: ItemDto[] }>(w, 'POST', `${API}/deposit/apply`, {
    entries: [{ path: p, contextId, attributes }],
  });

describe('apprentissage dans le Coffre', () => {
  it('3 fichiers du même site rangés dans un cours : le 4e y est proposé, avec la raison ; corrigé : la confiance baisse', async () => {
    w = await diskWorld();
    const [a] = await deposit(w, { 'intro.txt': 'x' }, ['Cours', 'Réseaux']);
    const [b] = await deposit(w, { 'autre.txt': 'y' }, ['Perso']);
    const reseaux = a!.contextId!;
    for (const n of ['vlan.pdf', 'ospf.pdf', 'rip.pdf'])
      await put(downloaded(n, 'cours.exemple.be'), reseaux);
    const fourth = await analyze(downloaded('bgp.pdf', 'cours.exemple.be'));
    expect(fourth.context).toMatchObject({ kind: 'existing', id: reseaux });
    expect(fourth.context!.reason).toBe(
      '3 fichiers de ce site rangés dans « Cours › Réseaux » (appris)',
    );
    let learned = await ok<LearnedRuleDto[]>(w, 'GET', `${API}/learned`);
    const site = learned.find((r) => r.kind === 'site')!;
    expect(site).toMatchObject({
      key: 'cours.exemple.be',
      contextPath: ['Cours', 'Réseaux'],
      hits: 3,
      misses: 0,
      confidence: 1,
      active: true,
    });
    // Thomas puts the 4th elsewhere, then moves another: corrections.
    const { created } = await put(downloaded('bgp2.pdf', 'cours.exemple.be'), b!.contextId!);
    await ok(w, 'PATCH', `${API}/items/${created[0]!.id}`, { contextId: b!.contextId });
    learned = await ok<LearnedRuleDto[]>(w, 'GET', `${API}/learned`);
    const after = learned.find((r) => r.kind === 'site' && r.contextId === reseaux)!;
    expect(after.misses).toBeGreaterThanOrEqual(1);
    expect(after.confidence).toBeLessThan(1);
  });

  it('extension dans un contexte → nature ; une nature choisie reste choisie', async () => {
    w = await diskWorld();
    const [first] = await deposit(w, { 'chap1.pdf': '1' }, ['Cours', 'Thermo']);
    const thermo = first!.contextId!;
    for (const id of [
      first!.id,
      (await deposit(w, { 'chap2.pdf': '2' }, ['Cours', 'Thermo']))[0]!.id,
    ])
      await ok(w, 'PUT', `${API}/items/${id}/attributes`, { key: 'nature', values: ['synthèse'] });
    const p = path.join(w.dl, 'thermo-chap3.pdf');
    writeFileSync(p, '3');
    const proposal = (await analyzeTask(w, { paths: [p] }))[0]!;
    // Its name says « Thermo »: that context; then the nature learned for .pdf there.
    expect(proposal.context).toMatchObject({ id: thermo });
    expect(proposal.attributes.find((a) => a.key === 'nature')).toMatchObject({
      value: 'synthèse',
      origin: 'guessed',
      reason: '2 fichiers .pdf de « Cours › Thermo » sont « synthèse » (appris)',
    });
    // An element whose nature Thomas chose: « Deviner à nouveau » leaves it.
    const [kept] = await deposit(w, { 'chap4.pdf': '4' }, ['Cours', 'Thermo']);
    await ok(w, 'PUT', `${API}/items/${kept!.id}/attributes`, {
      key: 'nature',
      values: ['examen'],
    });
    const again = await ok<ItemDto>(w, 'POST', `${API}/items/${kept!.id}/guess`, {});
    expect(again.attributes.find((a) => a.key === 'nature')).toMatchObject({
      value: 'examen',
      origin: 'chosen',
    });
  });

  it('modifier, supprimer, « Tout oublier » (confirmé)', async () => {
    w = await diskWorld();
    const [a] = await deposit(w, { 'labo-vlan.txt': '1' }, ['Cours', 'Réseaux']);
    const [b] = await deposit(w, { 'x.txt': '2' }, ['Perso']);
    let learned = await ok<LearnedRuleDto[]>(w, 'GET', `${API}/learned`);
    const labo = learned.find((r) => r.kind === 'word' && r.key === 'labo')!;
    expect(labo.active).toBe(false);
    const changed = await ok<LearnedRuleDto>(w, 'PATCH', `${API}/learned/${labo.id}`, {
      contextId: b!.contextId,
    });
    expect(changed).toMatchObject({ contextPath: ['Perso'], active: true });
    await ok(w, 'DELETE', `${API}/learned/${labo.id}`);
    learned = await ok<LearnedRuleDto[]>(w, 'GET', `${API}/learned`);
    expect(learned.some((r) => r.id === labo.id)).toBe(false);
    expect((await w.hub.request('POST', `${API}/learned/forget`, {})).status).toBe(400);
    const r = await ok<{ forgotten: number }>(w, 'POST', `${API}/learned/forget`, {
      confirm: true,
    });
    expect(r.forgotten).toBe(learned.length);
    expect(await ok<LearnedRuleDto[]>(w, 'GET', `${API}/learned`)).toEqual([]);
    // The elements themselves are untouched.
    expect((await ok<ItemDto>(w, 'GET', `${API}/items/${a!.id}`)).contextPath).toEqual([
      'Cours',
      'Réseaux',
    ]);
  });
});
