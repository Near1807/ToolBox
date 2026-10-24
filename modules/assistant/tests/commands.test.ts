// Standardised commands: a battery of realistic phrases (spoken, hesitant),
// against the real actions of the modules. Words only here (no embeddings
// model in the tests): the strictest mode. With TOOLBOX_EMBEDDINGS_DIR set to
// a model folder, the same battery runs with the embeddings too.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { OnnxEmbedder, embeddingsInstalled } from '../backend/embedder';
import { CommandIndex, DEFAULT_MATCH, type CommandSpec } from '../backend/matcher';

const ROOT = path.resolve(__dirname, '../..');
const MODEL_DIR = process.env.TOOLBOX_EMBEDDINGS_DIR ?? '';

/** Recognised, with the parameters taken from the phrase. */
const RECOGNISED: [string, string, Record<string, unknown>?][] = [
  ['ajoute une tâche finir le mix pour vendredi', 'todo.add-task', { title: 'finir le mix' }],
  [
    'euh ajoute une tâche appeler le studio demain',
    'todo.add-task',
    { title: 'appeler le studio' },
  ],
  [
    'tu peux ajouter acheter des cordes s’il te plaît',
    'todo.add-task',
    { title: 'acheter des cordes' },
  ],
  ['crée une tâche envoyer les stems avec le tag mix', 'todo.add-task', { tags: ['mix'] }],
  ['rappelle-moi de payer le mastering', 'todo.add-task', { title: 'payer le mastering' }],
  ['nouvelle tâche réserver la salle', 'todo.add-task', { title: 'réserver la salle' }],
  ['note de rappeler Paul lundi', 'todo.add-task', { title: 'rappeler Paul' }],
  ['qu’est-ce que j’ai à faire aujourd’hui', 'todo.list-tasks', { filter: 'today' }],
  ['bon, qu’est-ce que j’ai à faire', 'todo.list-tasks'],
  ['quelles sont mes tâches en retard', 'todo.list-tasks', { filter: 'overdue' }],
  ['mes tâches de la semaine', 'todo.list-tasks', { filter: 'week' }],
  ['liste mes tâches', 'todo.list-tasks'],
  ['coche la tâche finir le mix', 'todo.complete-task', { task: 'finir le mix' }],
  ['euh coche appeler le studio', 'todo.complete-task', { task: 'appeler le studio' }],
  ['supprime la tâche acheter des cordes', 'todo.delete-task', { task: 'acheter des cordes' }],
  ['efface la tâche de la bio', 'todo.delete-task', { task: 'bio' }],
  ['qu’est-ce que je dois publier aujourd’hui', 'release-planner.agenda', { period: 'today' }],
  ['qu’est-ce que je publie cette semaine', 'release-planner.agenda', { period: 'week' }],
  ['qu’est-ce qui est en retard dans le planning', 'release-planner.agenda', { period: 'late' }],
  ['résumé de la chaîne', 'youtube-stats.channel-summary'],
  ['comment va ma chaîne YouTube', 'youtube-stats.channel-summary'],
  ['combien de vues pour Aube', 'youtube-stats.track-stats', { track: 'Aube' }],
  ['les stats du morceau Nuit blanche', 'youtube-stats.track-stats', { track: 'Nuit blanche' }],
  ['où en est le morceau Aube', 'music-library.track-project', { track: 'Aube' }],
  ['quels rendus sont en cours', 'core.list-jobs'],
  ['ouvre le planning', 'core.open', { target: 'planning' }],
  ['euh ouvre les réglages', 'core.open', { target: 'réglages' }],
  ['lance la synchronisation des stats YouTube', 'youtube-stats.sync'],
  ['quelles sont les commandes', 'assistant.list-commands'],
  // Real phrases of Thomas's tests (v0.17), after the corrections of the ear.
  ['rappelle-moi d’appeler Thierry demain', 'todo.add-task', { title: 'appeler Thierry' }],
  ['quel est le planning de cette semaine', 'release-planner.agenda', { period: 'week' }],
  ['où en sont les sorties de cette semaine', 'release-planner.agenda', { period: 'week' }],
  ['le point sur la semaine', 'release-planner.agenda', { period: 'week' }],
  ['le planning de la semaine prochaine', 'release-planner.agenda', { period: 'next-week' }],
  ['qu’est-ce qui sort les 7 prochains jours', 'release-planner.agenda', { period: 'next7' }],
  ['où on est la sortie de Obsidian', 'release-planner.release', { track: 'Obsidian' }],
  ['ouvre la to-do', 'core.open', { target: 'to-do' }],
  ['ouvre l’application', 'core.show-app'],
  ['ouvre ToolBox', 'core.show-app'],
  ['reviens sur l’app', 'core.show-app'],
];

/** Never recognised: free questions, ambiguous or incomplete requests. */
const NOT_RECOGNISED = [
  'quelle est la capitale de l’Australie',
  'raconte-moi une blague',
  'tâche',
  'ajoute',
  'supprime',
  'le mix',
  'bonjour',
  'merci beaucoup',
  'est-ce que tu peux m’aider',
  'il fait beau aujourd’hui',
  'combien',
  'écris un texte pour mon prochain post',
  'publie la vidéo sur YouTube',
  'quel temps fera-t-il demain',
];

async function specsOf(hub: TestHub): Promise<CommandSpec[]> {
  return hub.hub.assistant
    .list()
    .filter((a) => a.extracts && a.examples.length > 0)
    .map((a) => ({
      id: a.id,
      moduleName: a.moduleName,
      description: a.description,
      risk: a.risk,
      required: a.required,
      phrases: a.examples.map((text) => ({ text, source: 'module' as const })),
      extract: (utterance: string) => hub.hub.assistant.extract(a.id, utterance),
    }));
}

const modes: [string, () => OnnxEmbedder | null][] = [['mots seuls', () => null]];
if (MODEL_DIR && embeddingsInstalled(MODEL_DIR))
  modes.push(['embeddings', () => new OnnxEmbedder(MODEL_DIR)]);

describe.each(modes)('standardised commands (%s)', (_mode, embedder) => {
  let hub: TestHub;
  const index = new CommandIndex(embedder());

  beforeAll(async () => {
    hub = await createTestHub({
      modules: await Promise.all(
        ['music-library', 'todo', 'release-planner', 'youtube-stats', 'assistant'].map((m) =>
          loadModuleFolder(path.join(ROOT, m)),
        ),
      ),
    });
    await index.build(await specsOf(hub));
  }, 60_000);
  afterAll(async () => {
    await hub.close();
  });

  it.each(RECOGNISED)('« %s » → %s', async (said, actionId, params) => {
    const result = await index.match(said, DEFAULT_MATCH);
    expect(
      { verdict: result.verdict, actionId: result.best?.actionId },
      `score ${result.best?.score.toFixed(2)}, écart ${result.gap.toFixed(2)} (2e : ${result.second?.actionId})`,
    ).toEqual({ verdict: 'recognised', actionId });
    if (params) expect(result.best!.params).toMatchObject(params);
  });

  it.each(NOT_RECOGNISED)('« %s » : pas reconnue', async (said) => {
    const result = await index.match(said, DEFAULT_MATCH);
    expect(
      result.verdict,
      `${result.best?.actionId} ${result.best?.score.toFixed(2)}, écart ${result.gap.toFixed(2)}`,
    ).not.toBe('recognised');
  });
});
