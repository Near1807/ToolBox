// Words of the assistant: corrections on whole words, expected words given to
// the speech recognition, and the dialogues « Tu voulais dire … ? » (a value
// that matches nothing) and « … ou … ? » (two close commands), with the
// phrase learnt only on Thomas's « oui ».
import { describe, expect, it } from 'vitest';
import type { AssistantActionInfo, AssistantOutcome, AssistantParams } from '@hub/sdk/backend';
import { Brain, pickChoice } from '../backend/brain';
import type { MatchResult } from '../backend/matcher';
import { applyCorrections, expectedWordsPrompt } from '../backend/vocabulary';

const corrections = [
  { id: 1, heard: 'tout doux', replacement: 'to-do' },
  { id: 2, heard: 'obsidienne', replacement: 'Obsidian' },
  { id: 3, heard: 'mix', replacement: 'mixage' },
];

describe('corrections (« quand l’oreille écrit X, comprendre Y »)', () => {
  it('replaces whole words, whatever the case and the accents', () => {
    expect(applyCorrections('Ouvre la Tout-Doux.', corrections)).toBe('Ouvre la to-do.');
    expect(applyCorrections('où en est la sortie d’OBSIDIENNE', corrections)).toBe(
      'où en est la sortie d’Obsidian',
    );
    expect(applyCorrections('tout doux tout doux', corrections)).toBe('to-do to-do');
  });

  it('never inside another word', () => {
    expect(applyCorrections('le mixage du remix', corrections)).toBe('le mixage du remix');
    expect(applyCorrections('tout douxième', corrections)).toBe('tout douxième');
    expect(applyCorrections('finir le mix', corrections)).toBe('finir le mixage');
  });

  it('leaves the text as it is without a correction', () => {
    expect(applyCorrections('ajoute une tâche', [])).toBe('ajoute une tâche');
  });
});

describe('expected words (whisper.cpp prompt)', () => {
  it('keeps the order, removes duplicates, stays short', () => {
    const prompt = expectedWordsPrompt([
      ['ToolBox', 'to-do'],
      ['To-do', 'Planning de sortie'],
      ['Obsidian', 'GrosKaillou'],
    ]);
    expect(prompt).toBe('ToolBox, to-do, Planning de sortie, Obsidian, GrosKaillou');
    const long = expectedWordsPrompt([Array.from({ length: 500 }, (_, i) => `morceau${i}`)], 100);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.startsWith('morceau0, morceau1')).toBe(true);
  });
});

describe('choices', () => {
  const labels = ['Planning d’une période', 'Où en est la sortie d’un morceau'];
  it('understands the answer by its rank or its words', () => {
    expect(pickChoice('le premier', labels)).toBe(0);
    expect(pickChoice('la deuxième', labels)).toBe(1);
    expect(pickChoice('2', labels)).toBe(1);
    expect(pickChoice('la sortie du morceau', labels)).toBe(1);
    expect(pickChoice('planning', labels)).toBe(0);
    expect(pickChoice('je sais pas', labels)).toBeNull();
  });
});

/** A brain whose recognition and actions are stubs: only the dialogue is tested. */
function brainWith(options: {
  match: Partial<MatchResult>;
  run: (id: string, params: unknown) => AssistantOutcome;
  learnt?: { id: string; text: string }[];
}) {
  const runs: { id: string; params: unknown }[] = [];
  const catalog = ['release-planner.release', 'release-planner.agenda'].map(
    (id) =>
      ({
        id,
        moduleId: 'release-planner',
        moduleName: 'Planning',
        name: id.split('.')[1]!,
        description: id,
        label: id.endsWith('release')
          ? 'Où en est la sortie d’un morceau'
          : 'Planning d’une période',
        parameters: {},
        required: [],
        risk: 'read',
        page: null,
        examples: [],
        extracts: true,
        right: null,
      }) as AssistantActionInfo,
  );
  const brain = new Brain({
    model: () => {
      throw new Error('no model');
    },
    modelName: () => 'none',
    think: () => undefined,
    actions: () => catalog,
    run: async (id, params) => {
      runs.push({ id, params });
      return options.run(id, params);
    },
    open: () => {},
    ai: () => false,
    recognise: async () =>
      ({
        verdict: 'low-score',
        best: null,
        second: null,
        gap: 0,
        ranking: [],
        semantic: false,
        suggestion: null,
        choices: [],
        ms: 1,
        ...options.match,
      }) as MatchResult,
    learn: async (id, text) => {
      options.learnt?.push({ id, text });
      return { saved: true, conflicts: [] };
    },
  });
  const say = (text: string) => brain.handle(text, () => {});
  return { brain, runs, say };
}

describe('dialogues', () => {
  const candidate = (actionId: string, params: AssistantParams, score = 0.72) => ({
    actionId,
    score,
    phrase: '',
    params,
    complete: true,
  });

  it('« Je ne trouve pas le morceau … Tu voulais dire « Obsidian » ? »: « oui » runs it', async () => {
    const { runs, say } = brainWith({
      match: {
        verdict: 'recognised',
        best: candidate('release-planner.release', { track: 'obsidienne' }),
      },
      run: (id, params) =>
        (params as { track: string }).track === 'Obsidian'
          ? {
              status: 'done',
              id,
              message: 'Sortie d’Obsidian : …',
              undoId: null,
              open: null,
              data: null,
            }
          : {
              status: 'error',
              id,
              message: 'Je ne trouve pas le morceau « obsidienne ».',
              notFound: {
                param: 'track',
                what: 'le morceau',
                value: 'obsidienne',
                suggestions: ['Obsidian'],
              },
            },
    });
    const first = await say('où on est la sortie de obsidienne');
    expect(first.reply).toBe(
      'Je ne trouve pas le morceau « obsidienne ». Tu voulais dire « Obsidian » ?',
    );
    expect(first.pending?.kind).toBe('retry');
    const answer = await say('oui');
    expect(answer.reply).toBe('Sortie d’Obsidian : …');
    expect(runs.at(-1)).toEqual({
      id: 'release-planner.release',
      params: { track: 'Obsidian' },
    });
  });

  it('« Tu voulais dire : … ou … ? »: the answer runs the chosen one, then offers to learn', async () => {
    const learnt: { id: string; text: string }[] = [];
    const { runs, say } = brainWith({
      match: {
        verdict: 'ambiguous',
        choices: [
          candidate('release-planner.release', { track: 'Aube' }, 0.69),
          candidate('release-planner.agenda', { period: 'week' }, 0.68),
        ],
      },
      run: (id) => ({
        status: 'done',
        id,
        message: 'Cette semaine : …',
        undoId: null,
        open: null,
        data: null,
      }),
      learnt,
    });
    const question = await say('où en sont les sorties de cette semaine');
    expect(question.reply).toBe(
      'Tu voulais dire : « Où en est la sortie d’un morceau » ou « Planning d’une période » ?',
    );
    expect(runs).toEqual([]);
    const chosen = await say('la deuxième');
    expect(runs).toEqual([{ id: 'release-planner.agenda', params: { period: 'week' } }]);
    expect(chosen.reply).toBe(
      'Cette semaine : … Je retiens « où en sont les sorties de cette semaine » pour « Planning d’une période » ?',
    );
    expect(learnt).toEqual([]);
    const learn = await say('oui');
    expect(learnt).toEqual([
      { id: 'release-planner.agenda', text: 'où en sont les sorties de cette semaine' },
    ]);
    expect(learn.reply).toMatch(/^C’est noté/);
  });

  it('« non » to the choice runs nothing', async () => {
    const { runs, say } = brainWith({
      match: {
        verdict: 'ambiguous',
        choices: [
          candidate('release-planner.release', { track: 'Aube' }),
          candidate('release-planner.agenda', { period: 'week' }),
        ],
      },
      run: (id) => ({ status: 'done', id, message: 'x', undoId: null, open: null, data: null }),
    });
    await say('où en sont les sorties de cette semaine');
    expect((await say('non')).reply).toBe('D’accord.');
    expect(runs).toEqual([]);
  });
});
