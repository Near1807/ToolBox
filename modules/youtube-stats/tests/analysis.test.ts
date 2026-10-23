import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  normaliseHeader,
  parseCsv,
  parseDate,
  parseNumber,
  reachRows,
  readExport,
  readTable,
} from '../backend/csv';
import { demoDataset } from '../backend/demo';
import { Indexed, zoned } from '../backend/dataset';
import { runLab } from '../backend/lab';
import { suggestTrack } from '../backend/linking';
import { retentionEvents, sections, segmentEnergy } from '../backend/music';
import { generateTheories, updateJournal, type Theory } from '../backend/theories';

describe('music of a video', () => {
  it('energy of an excerpt and sections estimated from it', () => {
    const peaks = Array.from({ length: 100 }, (_, i) =>
      i < 20 ? 0.1 : i < 35 ? 0.3 + (i - 20) * 0.04 : i < 70 ? 1 : 0.15,
    );
    const whole = segmentEnergy(peaks, 100, 0, 100, 100);
    const labels = sections(whole).map((s) => s.label);
    expect(labels[0]).toBe('Intro');
    expect(labels).toContain('Drop');
    expect(labels).toContain('Montée');
    expect(labels[labels.length - 1]).toBe('Outro');
    // An excerpt in the drop is all high energy.
    expect(Math.min(...segmentEnergy(peaks, 100, 40, 20, 50))).toBe(1);
  });

  it('retention events: a steep drop and a re-watched passage, tied to their section', () => {
    const points = Array.from({ length: 100 }, (_, i) => {
      const ratio = (i + 1) / 100;
      let watch = 1 - ratio * 0.3;
      if (ratio > 0.5) watch -= 0.2; // everybody leaves at the middle
      if (ratio > 0.8 && ratio <= 0.82) watch += 0.05; // re-watched
      return { ratio, watch, relative: null };
    });
    const list = [
      { from: 0, to: 0.5, label: 'Drop' as const, energy: 1 },
      { from: 0.5, to: 1, label: 'Pause' as const, energy: 0.2 },
    ];
    const events = retentionEvents(points, list);
    const drop = events.find((e) => e.kind === 'drop')!;
    expect(drop.ratio).toBeCloseTo(0.51, 2);
    expect(drop.section).toBe('Pause');
    expect(events.some((e) => e.kind === 'rewatch' && e.ratio > 0.8)).toBe(true);
  });
});

describe('Labo and theories on the demo channel', () => {
  const data = demoDataset(new Date('2026-10-23T12:00:00Z'));
  const lab = runLab(data);
  const theories = generateTheories(lab);

  it('is clearly a demo, with tracks, Shorts, retention and breakdowns', () => {
    expect(data.mode).toBe('demo');
    expect(data.videos.filter((v) => v.kind === 'short').length).toBeGreaterThan(20);
    expect(data.videos.some((v) => v.origin.link === null)).toBe(true); // one to link by hand
    const ix = new Indexed(data);
    const short = data.videos.find((v) => v.kind === 'short')!;
    expect(ix.relativeIndex(short, 7)).not.toBeNull();
    expect(data.retention[short.id]).toHaveLength(100);
  });

  it('finds the planted effects, with their tier', () => {
    const tuesday = theories.find((t) => t.key === 'weekday:short:1');
    expect(tuesday?.confidence.tier).toBe('solide');
    expect(tuesday?.text).toContain('mardi');
    // Short n always comes out the same weekday: flagged, not hidden.
    expect(tuesday?.caveat).toContain('impossible de séparer');
    expect(theories.find((t) => t.key === 'rabatteur:global')?.direction).toBe(1);
    expect(theories.find((t) => t.key === 'excerpt:energy-retention')?.confidence.tier).toBe(
      'solide',
    );
    // Groups of 2 Reels perso never make a « Solide ».
    for (const t of theories.filter((x) => x.family === 'style')) {
      if (Math.min(...t.confidence.n) < 4) expect(t.confidence.tier).toBe('intuition');
    }
  });

  it('every analysis carries numbers a page can show', () => {
    expect(lab.usual.find((u) => u.kind === 'short' && u.age === 7)?.median).toBeGreaterThan(0);
    expect(lab.heatmap[0]!.cells).toHaveLength(28);
    expect(lab.rabatteur.tracks.length).toBeGreaterThan(5);
    expect(lab.excerpts.list.every((e) => e.position >= 0 && e.position <= 1)).toBe(true);
    expect(lab.anomalies.some((a) => a.events.length > 0)).toBe(true);
  });

  it('the journal confirms, refutes and waits', () => {
    const base = theories.find((t) => t.key === 'rabatteur:global')!;
    const at = (tier: Theory['confidence']['tier'], direction: 1 | -1): Theory => ({
      ...base,
      direction,
      confidence: { ...base.confidence, tier },
    });
    let journal = updateJournal([], [at('piste', 1)], '2026-01-01T12:00:00Z');
    expect(journal[0]!.status).toBe('pending');
    journal = updateJournal(journal, [at('solide', 1)], '2026-02-01T12:00:00Z');
    expect(journal[0]!.status).toBe('pending');
    journal = updateJournal(journal, [at('solide', 1)], '2026-03-01T12:00:00Z');
    expect(journal[0]!.status).toBe('confirmed');
    journal = updateJournal(journal, [at('piste', -1)], '2026-04-01T12:00:00Z');
    expect(journal[0]!.status).toBe('refuted');
    expect(journal[0]!.history).toHaveLength(4);
    // Same day: the point is replaced, not added.
    journal = updateJournal(journal, [at('piste', -1)], '2026-04-01T18:00:00Z');
    expect(journal[0]!.history).toHaveLength(4);
  });
});

describe('YouTube Studio export (CSV)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-ys-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('parses quotes, separators and French numbers', () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('x;y\n1;2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('4.2%')).toBe(4.2);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('')).toBeNull();
    expect(parseDate('Oct 21, 2026')).toBe('2026-10-21');
    expect(parseDate('21/10/2026')).toBe('2026-10-21');
    expect(normaliseHeader('Taux de clics des impressions (%)')).toBe(
      'taux de clics des impressions %',
    );
  });

  it('detects the columns in French and English, skips the Total line', () => {
    const fr = readTable(
      'Table data.csv',
      'Contenu,Titre de la vidéo,Heure de publication de la vidéo,Impressions,Taux de clics des impressions (%)\nTotal,,,1000,4\nabcdefghijk,Drop,"21 oct. 2026",800,"5,2"\n',
    );
    expect(fr.kind).toBe('totals');
    expect(reachRows(fr)).toEqual([
      { videoId: 'abcdefghijk', day: null, impressions: 800, ctr: 5.2, title: 'Drop' },
    ]);
    const en = readTable(
      'Chart data.csv',
      'Date,Content,Video title,Impressions,Impressions click-through rate (%)\n2026-10-20,abcdefghijk,Drop,120,6.5\n',
    );
    expect(en.kind).toBe('daily');
    expect(reachRows(en)[0]).toMatchObject({ day: '2026-10-20', impressions: 120, ctr: 6.5 });
    expect(readTable('x.csv', 'Foo,Bar\n1,2').kind).toBe('unknown');
  });

  it('reads the .zip exported by Studio', async () => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('Content,Impressions\nabcdefghijk,50\n'), 'Table data.csv');
    zip.addBuffer(
      Buffer.from('Date,Content,Impressions\n2026-10-20,abcdefghijk,10\n'),
      'Chart data.csv',
    );
    zip.addBuffer(Buffer.from('ignored'), 'notes.txt');
    zip.end();
    const file = path.join(dir, 'export.zip');
    await new Promise<void>((resolve) => {
      const chunks: Buffer[] = [];
      zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
      zip.outputStream.on('end', () => {
        writeFileSync(file, Buffer.concat(chunks));
        resolve();
      });
    });
    const tables = await readExport(file);
    expect(tables.map((t) => [t.fileName, t.kind])).toEqual([
      ['Table data.csv', 'totals'],
      ['Chart data.csv', 'daily'],
    ]);
    await expect(readExport(path.join(dir, 'export.pdf'))).rejects.toThrow(/\.zip ou \.csv/);
  });
});

describe('linking and time zones', () => {
  it('suggests the track from the video title', () => {
    const tracks = [
      { id: 1, title: 'Aube' },
      { id: 2, title: 'Aube Rouge' },
      { id: 3, title: 'Dernier Métro' },
    ];
    expect(suggestTrack('Thomas — Dernier metro (live)', tracks)?.track.id).toBe(3);
    expect(suggestTrack('AUBE ROUGE - clip officiel', tracks)?.track.id).toBe(2);
    expect(suggestTrack('Vlog studio', tracks)).toBeNull();
  });

  it('publication hour in the chosen time zone', () => {
    expect(zoned('2026-10-20T16:00:00Z', 'Europe/Brussels')).toEqual({
      day: '2026-10-20',
      hour: 18,
      weekday: 1,
    });
    expect(zoned('2026-10-20T05:00:00Z', 'America/Los_Angeles').day).toBe('2026-10-19');
  });
});
