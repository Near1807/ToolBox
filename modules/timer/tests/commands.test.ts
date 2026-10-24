import { describe, expect, it } from 'vitest';
import {
  extractPause,
  extractPreset,
  extractResume,
  extractSkip,
  extractStart,
  extractStatus,
  extractStop,
  parseDuration,
} from '../backend/commands';

describe('durations said in French', () => {
  it.each([
    ['27 minutes', 27],
    ['vingt-sept minutes', 27],
    ['vingt et une minutes', 21],
    ['quarante-cinq min', 45],
    ['une heure', 60],
    ['1 h 30', 90],
    ['1h30', 90],
    ['une heure et demie', 90],
    ['deux heures', 120],
    ['une demi-heure', 30],
    ['un quart d’heure', 15],
    ['trois quarts d’heure', 45],
  ])('« %s » = %i min', (said, minutes) => {
    expect(parseDuration(said)?.minutes).toBe(minutes);
  });
  it('nothing when there is no duration', () => {
    expect(parseDuration('finir le mix')).toBeNull();
  });
});

describe('standardised commands of the Timer', () => {
  it.each([
    ['lance un timer de 27 minutes', { minutes: 27 }],
    ['lance un timer de 27 minutes sur finir le mix', { minutes: 27, task: 'finir le mix' }],
    ['démarre un minuteur de 45 minutes pour la bio', { minutes: 45, task: 'la bio' }],
    ['mets un timer d’une heure', { minutes: 60 }],
    [
      'euh, tu peux lancer un timer de vingt minutes sur appeler le studio s’il te plaît',
      {
        minutes: 20,
        task: 'appeler le studio',
      },
    ],
    ['timer de 25 minutes', { minutes: 25 }],
  ])('« %s »', (said, expected) => {
    expect(extractStart(said)).toEqual(expected);
  });
  it('a timer without duration is not understood (never guessed)', () => {
    expect(extractStart('lance un timer')).toBeNull();
    expect(extractStart('lance mon démarrage doux')).toBeNull();
  });
  it('presets by name', () => {
    expect(extractPreset('lance mon démarrage doux')).toEqual({ preset: 'démarrage doux' });
    expect(extractPreset('lance le pomodoro classique')).toEqual({ preset: 'pomodoro classique' });
    expect(extractPreset('démarre ma session démarrage doux')).toEqual({
      preset: 'démarrage doux',
    });
    expect(extractPreset('lance un timer de 27 minutes')).toBeNull();
  });
  it('pause, resume, stop, skip, status', () => {
    expect(extractPause('mets le timer en pause')).toEqual({});
    expect(extractPause('passe la pause')).toBeNull();
    expect(extractSkip('passe la pause')).toEqual({});
    expect(extractResume('reprends le timer')).toEqual({});
    expect(extractStop('arrête le timer')).toEqual({});
    expect(extractStatus('combien de temps il reste')).toEqual({});
    expect(extractStatus('ajoute une tâche')).toBeNull();
  });
});
