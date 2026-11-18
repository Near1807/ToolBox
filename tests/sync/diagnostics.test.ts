// v0.41.0: the witness and « Réseaux et adresses », pure parts: each state of
// the witness and its reason, the history capped at 50, the networks where
// an exchange was tried (named, first and last success, last failure), the
// Windows profiles read (read only, Public detected).
import { describe, expect, it } from 'vitest';
import {
  ago,
  cleanLabel,
  MAX_ATTEMPTS,
  pcWitness,
  pendingFailure,
  PUBLIC_NETWORK,
  type PcSyncFacts,
  type SyncAttempt,
  withAttempt,
  withNetworkAttempt,
} from '../../backend/core/sync/diagnostics';
import { allPublic, parseProfiles, pcNetworks } from '../../backend/core/sync/network';

const NOW = Date.parse('2026-11-17T14:00:00Z');
const base: PcSyncFacts = {
  enabled: true,
  error: null,
  publicNetwork: false,
  refusal: null,
  failure: null,
  lastOk: null,
};

describe('the PC’s witness', () => {
  it('each state, the same words as the phone’s, and the reason in plain words', () => {
    expect(pcWitness({ ...base, enabled: false }, NOW)).toMatchObject({
      state: 'off',
      text: 'Synchro arrêtée',
    });
    expect(pcWitness(base, NOW)).toMatchObject({
      state: 'waiting',
      text: 'En attente du téléphone',
      detail: null,
    });
    const five = new Date(NOW - 5 * 60_000).toISOString();
    expect(pcWitness({ ...base, lastOk: { at: five, peer: 'S21' } }, NOW)).toMatchObject({
      state: 'synced',
      text: 'Synchronisé · il y a 5 min',
      detail: 'avec S21',
    });
    const old = new Date(NOW - 3 * 86_400_000).toISOString();
    expect(pcWitness({ ...base, lastOk: { at: old, peer: 'S21' } }, NOW)).toMatchObject({
      state: 'waiting',
      detail: 'Dernière synchro il y a 3 j',
    });
    const blocked = (f: Partial<PcSyncFacts>) => pcWitness({ ...base, ...f }, NOW);
    expect(
      blocked({ error: 'Le port 47400 est déjà utilisé : choisis-en un autre.' }),
    ).toMatchObject({
      state: 'blocked',
      text: 'Synchro bloquée',
      detail: 'Le port 47400 est déjà utilisé : choisis-en un autre.',
    });
    expect(blocked({ publicNetwork: true }).detail).toBe(PUBLIC_NETWORK);
    expect(blocked({ publicNetwork: true }).detail).toMatch(/Passe ce réseau en Privé/);
    expect(
      blocked({
        refusal:
          'Le téléphone a une version plus ancienne : mets à jour l’application sur le téléphone.',
      }).detail,
    ).toMatch(/mets à jour l’application sur le téléphone/);
    expect(
      blocked({
        failure: {
          at: five,
          reason: 'Connexion refusée : le certificat du PC n’a pas été accepté',
        },
      }).detail,
    ).toMatch(/certificat/);
    // Off wins over everything; the listener's error before the network, the network before the versions.
    expect(blocked({ enabled: false, error: 'x', publicNetwork: true }).state).toBe('off');
    expect(blocked({ error: 'port', publicNetwork: true, refusal: 'v' }).detail).toBe('port');
    expect(blocked({ publicNetwork: true, refusal: 'v' }).detail).toBe(PUBLIC_NETWORK);
  });

  it('« il y a … »', () => {
    expect(ago(new Date(NOW - 20_000).toISOString(), NOW)).toBe('à l’instant');
    expect(ago(new Date(NOW - 2 * 3_600_000).toISOString(), NOW)).toBe('il y a 2 h');
  });

  it('what still blocks: the last attempt when it failed (a success after it clears it)', () => {
    const fail: SyncAttempt = { at: 'a', ok: false, where: 'x', reason: 'r' };
    const ok: SyncAttempt = { at: 'b', ok: true, where: 'x', reason: null };
    expect(pendingFailure([fail, ok])).toEqual({ at: 'a', reason: 'r' });
    expect(pendingFailure([ok, fail])).toBeNull();
    expect(pendingFailure([])).toBeNull();
  });
});

describe('the history and the networks', () => {
  it('the last 50 attempts, newest first; the oldest beyond are dropped', () => {
    let list: SyncAttempt[] = [];
    for (let i = 0; i < 55; i++)
      list = withAttempt(list, {
        at: `t${i}`,
        ok: i % 2 === 0,
        where: 'Kot',
        reason: i % 2 ? 'non' : null,
      });
    expect(list).toHaveLength(MAX_ATTEMPTS);
    expect(list[0]!.at).toBe('t54');
    expect(list.at(-1)!.at).toBe('t5');
  });

  it('a network: added at its first attempt, its first and last success, its last failure; the name kept', () => {
    let nets = withNetworkAttempt(
      [],
      { network: 'Kot-WiFi', address: '192.168.0.12' },
      {
        at: '1',
        ok: false,
        reason: 'versions',
      },
    );
    expect(nets).toEqual([
      {
        key: 'net:Kot-WiFi',
        label: null,
        network: 'Kot-WiFi',
        addresses: ['192.168.0.12'],
        firstOk: null,
        lastOk: null,
        lastFail: { at: '1', reason: 'versions' },
      },
    ]);
    nets = nets.map((n) => ({ ...n, label: 'Kot' }));
    nets = withNetworkAttempt(
      nets,
      { network: 'Kot-WiFi', address: '192.168.0.13' },
      { at: '2', ok: true, reason: null },
    );
    nets = withNetworkAttempt(
      nets,
      { network: 'Kot-WiFi', address: '192.168.0.13' },
      { at: '3', ok: true, reason: null },
    );
    expect(nets[0]).toMatchObject({
      label: 'Kot',
      addresses: ['192.168.0.12', '192.168.0.13'],
      firstOk: '2',
      lastOk: '3',
      lastFail: { at: '1' },
    });
    // No name from Windows: by the PC's address.
    nets = withNetworkAttempt(
      nets,
      { network: null, address: '10.0.0.5' },
      { at: '4', ok: true, reason: null },
    );
    expect(nets.map((n) => n.key)).toEqual(['net:Kot-WiFi', 'ip:10.0.0.5']);
    expect(cleanLabel('  Maison   de  maman ')).toBe('Maison de maman');
    expect(cleanLabel('   ')).toBeNull();
    expect(cleanLabel(12)).toBeNull();
    expect(cleanLabel('x'.repeat(60))).toHaveLength(40);
  });
});

describe('the Windows profiles (read only)', () => {
  it('Get-NetConnectionProfile as JSON: one object or a list, numbers or names', () => {
    expect(parseProfiles('{"Name":"ECAM","InterfaceAlias":"Wi-Fi","NetworkCategory":0}')).toEqual([
      { name: 'ECAM', alias: 'Wi-Fi', category: 'public' },
    ]);
    expect(
      parseProfiles(
        '[{"Name":"Kot","InterfaceAlias":"Wi-Fi","NetworkCategory":"Private"},{"Name":"Entreprise","InterfaceAlias":"Ethernet","NetworkCategory":2}]',
      ),
    ).toEqual([
      { name: 'Kot', alias: 'Wi-Fi', category: 'private' },
      { name: 'Entreprise', alias: 'Ethernet', category: 'domain' },
    ]);
    expect(parseProfiles('')).toEqual([]);
    expect(parseProfiles('not json')).toEqual([]);
    expect(parseProfiles('{"Name":"x"}')).toEqual([]);
  });

  it('the PC’s addresses with their network; Public only when every local network is Public', () => {
    const nets = pcNetworks(
      [
        { alias: 'Wi-Fi', address: '10.1.2.3' },
        { alias: 'Ethernet', address: '192.168.1.4' },
      ],
      [{ alias: 'Wi-Fi', name: 'ECAM', category: 'public' }],
    );
    expect(nets).toEqual([
      { alias: 'Wi-Fi', address: '10.1.2.3', name: 'ECAM', category: 'public' },
      { alias: 'Ethernet', address: '192.168.1.4', name: null, category: null },
    ]);
    expect(allPublic(nets)).toBe(false);
    expect(allPublic(nets.slice(0, 1))).toBe(true);
    expect(allPublic([])).toBe(false);
  });
});
