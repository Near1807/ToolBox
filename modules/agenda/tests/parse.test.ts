// The Agenda's quick bar (pure): every example of the request and the edge
// cases. Today: Thursday 12 November 2026 (« jeudi » is then the 19th).
import { describe, expect, it } from 'vitest';
import { parseQuick, previewText } from '../shared/parse';

const TODAY = '2026-11-12';
const p = (text: string) => parseQuick(text, TODAY);

describe('the quick bar', () => {
  it('« dentiste jeudi 14h 1h »: an event next Thursday 14:00–15:00', () => {
    expect(p('dentiste jeudi 14h 1h')).toEqual({
      kind: 'event',
      title: 'Dentiste',
      start: '2026-11-19T14:00',
      end: '2026-11-19T15:00',
      allDay: false,
      category: 'Rendez-vous',
    });
    expect(previewText(p('dentiste jeudi 14h 1h'), TODAY)).toBe(
      'Sera ajouté : Dentiste · jeu. 19 nov. 14:00–15:00',
    );
  });

  it('« réunion staff mardi 20h »: 1 h by default', () => {
    expect(p('réunion staff mardi 20h')).toMatchObject({
      kind: 'event',
      title: 'Réunion staff',
      start: '2026-11-17T20:00',
      end: '2026-11-17T21:00',
    });
  });

  it('« week-end scout 13-15 février »: all day over three days', () => {
    expect(p('week-end scout 13-15 février')).toEqual({
      kind: 'event',
      title: 'Week-end scout',
      start: '2027-02-13',
      end: '2027-02-15',
      allDay: true,
      category: 'Rendez-vous',
    });
    expect(previewText(p('week-end scout 13-15 février'), TODAY)).toBe(
      'Sera ajouté : Week-end scout · sam. 13 févr. 2027 → lun. 15 févr. 2027',
    );
    expect(p('camp du 30 janvier au 2 février #loisirs')).toMatchObject({
      start: '2027-01-30',
      end: '2027-02-02',
      allDay: true,
      category: 'Loisirs',
    });
    expect(p('stage du 16 au 20 novembre')).toMatchObject({
      title: 'Stage',
      start: '2026-11-16',
      end: '2026-11-20',
    });
  });

  it('« examen math 18 janvier »: all day', () => {
    expect(p('examen math 18 janvier #examens')).toEqual({
      kind: 'event',
      title: 'Examen math',
      start: '2027-01-18',
      end: '2027-01-18',
      allDay: true,
      category: 'Examens',
    });
  });

  it('« préparer la réunion ~1h avant vendredi »: a task of the To-do', () => {
    expect(p('préparer la réunion ~1h avant vendredi')).toEqual({
      kind: 'task',
      title: 'préparer la réunion',
      due: '2026-11-13',
      durationMin: 60,
      start: null,
    });
    expect(previewText(p('préparer la réunion ~1h avant vendredi'), TODAY)).toBe(
      'Sera ajouté à la To-do (à caser) : préparer la réunion · pour ven. 13 nov. · ~1 h',
    );
    // Nothing dated: a task too.
    expect(p('acheter du pain')).toEqual({
      kind: 'task',
      title: 'acheter du pain',
      due: null,
      durationMin: null,
      start: null,
    });
  });

  it('hours: ranges, « à », length after, no length taken for a second hour', () => {
    expect(p('cours de solfège de 18h à 19h30 lundi #cours')).toMatchObject({
      title: 'Cours de solfège',
      start: '2026-11-16T18:00',
      end: '2026-11-16T19:30',
      category: 'Cours',
    });
    expect(p('répétition 14h-16h samedi')).toMatchObject({
      start: '2026-11-14T14:00',
      end: '2026-11-14T16:00',
    });
    expect(p('appel banque demain à 9h30 pendant 15min')).toMatchObject({
      title: 'Appel banque',
      start: '2026-11-13T09:30',
      end: '2026-11-13T09:45',
    });
    expect(p('film 20h30')).toMatchObject({ start: '2026-11-12T20:30', end: '2026-11-12T21:30' });
    // A late night: past midnight.
    expect(p('soirée samedi 22h 4h')).toMatchObject({
      start: '2026-11-14T22:00',
      end: '2026-11-15T02:00',
    });
  });

  it('the week type: « tous les jeudis 19h 2h », « chaque mardi 20h »', () => {
    expect(p('badminton tous les jeudis 19h 2h #sport')).toEqual({
      kind: 'weekly',
      title: 'Badminton',
      weekday: 3,
      time: '19:00',
      durationMin: 120,
      category: 'Sport',
    });
    expect(p('réunion chaque mardi 20h')).toMatchObject({ kind: 'weekly', weekday: 1 });
    expect(previewText(p('réunion chaque mardi 20h'), TODAY)).toBe(
      'Sera ajouté à la semaine type : Réunion · chaque mardi 20:00–21:00',
    );
  });

  it('edge cases: errors, empty, nothing guessed in the title', () => {
    expect(p('')).toEqual({ kind: 'empty' });
    expect(p('   ')).toEqual({ kind: 'empty' });
    expect(p('jeudi 14h')).toMatchObject({ kind: 'error' });
    expect(p('foot tous les lundis')).toMatchObject({ kind: 'error' });
    expect(p('stage 15-13 février')).toEqual({
      kind: 'error',
      message: 'La fin est avant le début.',
    });
    expect(p('réunion 16h à 15h')).toMatchObject({ kind: 'error' });
    expect(p('vacances 30-31 février')).toMatchObject({ kind: 'error' });
    // A date inside the title is not taken (only at the end).
    expect(p('relire le 3 mars du livre ~2h')).toMatchObject({ kind: 'task', due: null });
    expect(p('anniversaire de Léa le 3 décembre')).toMatchObject({
      title: 'Anniversaire de Léa',
      start: '2026-12-03',
      allDay: true,
    });
  });
});

// v0.35.0
const TODAY_THU = '2026-11-12';
describe('the Agenda bar (only « ~ » phrases are tasks)', () => {
  it('a « ~ » phrase with an hour is a planned task; without « ~ » still an event', () => {
    const task = parseQuick('réviser stats ~2h mercredi 14h', TODAY_THU);
    expect(task).toEqual({
      kind: 'task',
      title: 'réviser stats',
      due: null,
      durationMin: 120,
      start: '2026-11-18T14:00',
    });
    expect(previewText(task, TODAY_THU)).toBe(
      'Sera ajouté à la To-do : réviser stats · prévu mer. 18 nov. 14:00 · ~2 h',
    );
    expect(parseQuick('appeler Paul 14h', TODAY_THU)).toMatchObject({
      kind: 'event',
      start: '2026-11-12T14:00',
    });
    expect(parseQuick('dentiste jeudi 14h 1h', TODAY_THU)).toMatchObject({
      kind: 'event',
      start: '2026-11-19T14:00',
      end: '2026-11-19T15:00',
    });
  });
});
