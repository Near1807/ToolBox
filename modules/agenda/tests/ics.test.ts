// Reading an .ics file (v0.37.0): folded lines, escapes, time zones (TZID,
// UTC, whole days, daylight saving), repetitions (COUNT, UNTIL, several
// BYDAY, INTERVAL, EXDATE, RECURRENCE-ID), what is not handled (listed),
// and a file that is not a calendar (a clear message). The local time of
// these tests is Brussels (set here; the other tests run in UTC).
process.env.TZ = 'Europe/Brussels';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportFileError, parseIcs, unescapeText } from '../shared/ics';
import { noteOf, splitTitle } from '../shared/import-item';

const HORIZON = { horizon: '2027-12-31' };
const cal = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const FIXTURE = readFileSync(path.join(__dirname, 'fixtures', 'horaire-ecam.ics'), 'utf8');

describe('reading an .ics file', () => {
  it('the synthetic timetable: name, 110 events, occurrences, one listed error', () => {
    expect(FIXTURE.match(/BEGIN:VEVENT/g)).toHaveLength(110);
    const p = parseIcs(FIXTURE, HORIZON);
    expect(p.calendarName).toBe('Horaire ECAM');
    expect(p.errors).toEqual([
      {
        line: expect.any(Number),
        reason: 'répétition non prise en charge : « RRULE:FREQ=MONTHLY;BYMONTHDAY=7;COUNT=5 »',
      },
    ]);
    // 92 single courses + 8 exams + 2 others, and the occurrences of 7 repeated courses.
    const repeated = p.items.filter((i) => i.key.includes('#'));
    expect(p.items.length - repeated.length).toBe(102);
    expect(repeated).toHaveLength(12 + 14 + 20 + 7 + 8 + 17 + 7);
    expect(new Set(p.items.map((i) => i.key)).size).toBe(p.items.length);
    expect(p.items.filter((i) => i.rawCategory === 'X')).toHaveLength(8);
    expect(p.items.every((i) => /^[HX]-.+@ecole\.be(#\d{8})?$/.test(i.key))).toBe(true);
  });

  it('folded lines and escapes (\\n, \\, and \\;), the text kept as it was', () => {
    const p = parseIcs(
      cal(
        event(
          'UID:a@x',
          'DTSTART:20261120T100000',
          'DTEND:20261120T110000',
          'SUMMARY:TH2C:Thermo',
          'DESCRIPTION:Act:Labo\\, séance 2\\; groupe B\\nGroupe:4MIN-7a\\nEns:BR',
          ' N',
          'LOCATION:2F51\\;2E51\\;2E44',
        ),
      ),
      HORIZON,
    );
    const [item] = p.items;
    expect(item!.title).toBe('Thermo');
    expect(item!.code).toBe('TH2C');
    expect(item!.location).toBe('2F51;2E51;2E44');
    expect(item!.note).toBe(
      'Activité : Labo, séance 2; groupe B · Groupe : 4MIN-7a · Enseignants : BRN',
    );
    expect(item!.original.DESCRIPTION).toBe(
      'Act:Labo, séance 2; groupe B\nGroupe:4MIN-7a\nEns:BRN',
    );
    expect(unescapeText('a\\\\b\\Nc\\ d')).toBe('a\\b\nc d');
  });

  it('the exam type stays visible; a prefix that is not a code stays in the title', () => {
    expect(splitTitle('TH2C:Thermo[ECRIT]')).toEqual({ title: 'Thermo · Écrit', code: 'TH2C' });
    expect(splitTitle('AN3L:Anglais [ORAL]')).toEqual({ title: 'Anglais · Oral', code: 'AN3L' });
    expect(splitTitle('Réunion: budget')).toEqual({ title: 'Réunion: budget', code: null });
    expect(noteOf('TH2C:Thermo[ECRIT] \nEns:BRG PCH VDD', 'TH2C:Thermo[ECRIT]')).toBe(
      'Enseignants : BRG PCH VDD',
    );
  });

  it('time zones: TZID (winter, summer), UTC « Z », floating, whole days (end exclusive)', () => {
    const p = parseIcs(
      cal(
        event(
          'UID:w',
          'DTSTART;TZID=Europe/Paris:20260115T083000',
          'DTEND;TZID=Europe/Paris:20260115T100000',
          'SUMMARY:Hiver',
        ),
        event(
          'UID:s',
          'DTSTART;TZID=Europe/Paris:20260615T083000',
          'DURATION:PT90M',
          'SUMMARY:Été',
        ),
        event('UID:z', 'DTSTART:20260615T063000Z', 'DTEND:20260615T080000Z', 'SUMMARY:UTC'),
        event(
          'UID:ny',
          'DTSTART;TZID=America/New_York:20260115T083000',
          'DTEND;TZID=America/New_York:20260115T093000',
          'SUMMARY:New York',
        ),
        event('UID:f', 'DTSTART:20260615T083000', 'SUMMARY:Flottant'),
        event('UID:d', 'DTSTART;VALUE=DATE:20261231', 'DTEND;VALUE=DATE:20270102', 'SUMMARY:Congé'),
        event('UID:d1', 'DTSTART;VALUE=DATE:20261224', 'SUMMARY:Réveillon'),
      ),
      HORIZON,
    );
    const by = Object.fromEntries(p.items.map((i) => [i.key, [i.start, i.end, i.allDay]]));
    expect(by).toEqual({
      w: ['2026-01-15T08:30', '2026-01-15T10:00', false],
      s: ['2026-06-15T08:30', '2026-06-15T10:00', false],
      z: ['2026-06-15T08:30', '2026-06-15T10:00', false],
      ny: ['2026-01-15T14:30', '2026-01-15T15:30', false],
      f: ['2026-06-15T08:30', '2026-06-15T09:30', false], // No end: one hour.
      d: ['2026-12-31', '2027-01-01', true],
      d1: ['2026-12-24', '2026-12-24', true],
    });
  });

  it('a TZID the system does not know: the file’s own VTIMEZONE', () => {
    const p = parseIcs(
      cal(
        'BEGIN:VTIMEZONE',
        'TZID:Romance Standard Time',
        'BEGIN:STANDARD',
        'DTSTART:16010101T030000',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0100',
        'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'DTSTART:16010101T020000',
        'TZOFFSETFROM:+0100',
        'TZOFFSETTO:+0200',
        'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
        'END:DAYLIGHT',
        'END:VTIMEZONE',
        event(
          'UID:a',
          'DTSTART;TZID="Romance Standard Time":20260115T083000',
          'DURATION:PT1H',
          'SUMMARY:A',
        ),
        event(
          'UID:b',
          'DTSTART;TZID=Romance Standard Time:20260715T083000',
          'DURATION:PT1H',
          'SUMMARY:B',
        ),
        event(
          'UID:c',
          'DTSTART;TZID=Nowhere/Unknown:20260715T083000',
          'DURATION:PT1H',
          'SUMMARY:C',
        ),
      ),
      HORIZON,
    );
    expect(p.items.map((i) => i.start)).toEqual(['2026-01-15T08:30', '2026-07-15T08:30']);
    expect(p.errors).toEqual([
      { line: expect.any(Number), reason: 'fuseau horaire inconnu : « Nowhere/Unknown »' },
    ]);
  });

  it('daylight saving: a weekly course stays at 08:15 across the change of hour', () => {
    const p = parseIcs(
      cal(
        event(
          'UID:r',
          'DTSTART;TZID=Europe/Paris:20261020T081500',
          'DTEND;TZID=Europe/Paris:20261020T100000',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'SUMMARY:Thermo',
        ),
      ),
      HORIZON,
    );
    expect(p.items.map((i) => [i.key, i.start, i.end])).toEqual([
      ['r#20261020', '2026-10-20T08:15', '2026-10-20T10:00'],
      ['r#20261027', '2026-10-27T08:15', '2026-10-27T10:00'], // After the change (25 October).
      ['r#20261103', '2026-11-03T08:15', '2026-11-03T10:00'],
    ]);
  });

  it('repetitions: COUNT, UNTIL, several BYDAY, INTERVAL, EXDATE, RDATE, RECURRENCE-ID, CANCELLED', () => {
    const tz = 'DTSTART;TZID=Europe/Paris:';
    const p = parseIcs(
      cal(
        event(
          'UID:count',
          `${tz}20261103T081500`,
          'DURATION:PT1H',
          'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=TU',
          'SUMMARY:C',
        ),
        event(
          'UID:until',
          `${tz}20261104T100000`,
          'DURATION:PT1H',
          'RRULE:FREQ=WEEKLY;UNTIL=20261118T090000Z;BYDAY=WE',
          'SUMMARY:U',
        ),
        event(
          'UID:days',
          `${tz}20261102T100000`,
          'DURATION:PT1H',
          'RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,TH',
          'SUMMARY:D',
        ),
        event(
          'UID:every2',
          `${tz}20261106T100000`,
          'DURATION:PT1H',
          'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3;BYDAY=FR',
          'SUMMARY:I',
        ),
        event(
          'UID:ex',
          `${tz}20261102T140000`,
          'DURATION:PT1H',
          'RRULE:FREQ=DAILY;COUNT=4',
          'EXDATE;TZID=Europe/Paris:20261103T140000,20261104T140000',
          'SUMMARY:E',
        ),
        event(
          'UID:rd',
          `${tz}20261102T140000`,
          'DURATION:PT1H',
          'RDATE;TZID=Europe/Paris:20261110T150000',
          'SUMMARY:R',
        ),
        event(
          'UID:moved',
          `${tz}20261102T090000`,
          'DURATION:PT1H',
          'RRULE:FREQ=WEEKLY;COUNT=2',
          'SUMMARY:M',
        ),
        event(
          'UID:moved',
          'RECURRENCE-ID;TZID=Europe/Paris:20261109T090000',
          `${tz}20261110T110000`,
          'DURATION:PT1H',
          'SUMMARY:M déplacé',
        ),
        event(
          'UID:gone',
          `${tz}20261102T090000`,
          'DURATION:PT1H',
          'STATUS:CANCELLED',
          'SUMMARY:Annulé',
        ),
      ),
      HORIZON,
    );
    const by = (uid: string) =>
      p.items.filter((i) => i.key.startsWith(`${uid}`)).map((i) => i.start);
    expect(by('count')).toEqual(['2026-11-03T08:15', '2026-11-10T08:15', '2026-11-17T08:15']);
    expect(by('until')).toEqual(['2026-11-04T10:00', '2026-11-11T10:00', '2026-11-18T10:00']);
    expect(by('days')).toEqual([
      '2026-11-02T10:00',
      '2026-11-05T10:00',
      '2026-11-09T10:00',
      '2026-11-12T10:00',
    ]);
    expect(by('every2')).toEqual(['2026-11-06T10:00', '2026-11-20T10:00', '2026-12-04T10:00']);
    expect(by('ex')).toEqual(['2026-11-02T14:00', '2026-11-05T14:00']); // COUNT counts the excluded ones.
    expect(by('rd')).toEqual(['2026-11-02T14:00', '2026-11-10T15:00']);
    expect(
      p.items.filter((i) => i.key.startsWith('moved')).map((i) => [i.key, i.start, i.title]),
    ).toEqual([
      ['moved#20261102', '2026-11-02T09:00', 'M'],
      ['moved#20261109', '2026-11-10T11:00', 'M déplacé'],
    ]);
    expect(by('gone')).toEqual([]);
    expect(p.errors).toEqual([]);
  });

  it('a rule without end stops at the horizon; an unhandled rule is listed, nothing else lost', () => {
    const p = parseIcs(
      cal(
        event(
          'UID:forever',
          'DTSTART:20261102T090000',
          'DURATION:PT1H',
          'RRULE:FREQ=WEEKLY',
          'SUMMARY:F',
        ),
        event(
          'UID:monthly',
          'DTSTART:20261102T090000',
          'RRULE:FREQ=MONTHLY;COUNT=3',
          'SUMMARY:Mois',
        ),
        event(
          'UID:ordinal',
          'DTSTART:20261102T090000',
          'RRULE:FREQ=WEEKLY;BYDAY=1MO',
          'SUMMARY:Ordinal',
        ),
        event('UID:nostart', 'SUMMARY:Sans début'),
        event('UID:ok', 'DTSTART:20261102T090000', 'SUMMARY:Ok'),
      ),
      { horizon: '2026-11-30' },
    );
    expect(
      p.items.filter((i) => i.key.startsWith('forever')).map((i) => i.start.slice(0, 10)),
    ).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(p.items.map((i) => i.key)).toContain('ok');
    expect(p.errors.map((e) => e.reason)).toEqual([
      'répétition non prise en charge : « RRULE:FREQ=MONTHLY;COUNT=3 »',
      'répétition non prise en charge : « RRULE:FREQ=WEEKLY;BYDAY=1MO »',
      'début (DTSTART) manquant',
    ]);
    expect(p.errors.every((e) => e.line > 0)).toBe(true);
  });

  it('a file that is not a calendar: a clear message', () => {
    expect(() => parseIcs('Bonjour,\nceci est une lettre.', HORIZON)).toThrow(ImportFileError);
    expect(() => parseIcs('Bonjour', HORIZON)).toThrow(/n’est pas un calendrier ICS/);
    expect(() => parseIcs('', HORIZON)).toThrow(ImportFileError);
    expect(() => parseIcs(cal(), HORIZON)).toThrow(/vide/);
  });
});
