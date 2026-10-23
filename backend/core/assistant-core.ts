import { extractName, HttpError, type AssistantActionDefinition } from '../../packages/sdk/backend';
import type { Hub } from './hub';

// Actions of the hub itself (module id "core"): tasks in progress, list of the
// tools, and navigation (open a tool or a page of the shell).

const SHELL_PAGES: { route: string; label: string; words: string[] }[] = [
  { route: '/', label: 'l’accueil', words: ['accueil', 'home', 'debut'] },
  { route: '/jobs', label: 'les tâches en cours', words: ['taches', 'rendus', 'jobs', 'file'] },
  { route: '/outputs', label: 'les fichiers générés', words: ['fichiers', 'corbeille', 'sorties'] },
  { route: '/settings', label: 'les réglages', words: ['reglages', 'parametres', 'options'] },
  { route: '/logs', label: 'les journaux', words: ['journaux', 'logs'] },
];

/** Lower case, no accents, single spaces: for matching what was said. */
export function normaliseWords(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const OPEN_PREFIXES = [
  /(?:ouvre|ouvrir|affiche|montre|va dans|va sur|va à|va a|aller dans|aller sur|emmène-moi dans|emmène-moi sur|passe sur|passe à)(?:[- ]moi)?(?![\p{L}])/iu,
];

const STATUS_LABELS: Record<string, string> = {
  queued: 'en attente',
  running: 'en cours',
  failed: 'en échec',
  interrupted: 'interrompue',
};

export function registerCoreActions(hub: Hub): void {
  const define = (action: AssistantActionDefinition) =>
    hub.assistant.define('core', 'ToolBox', action);

  define({
    name: 'list-jobs',
    description:
      'Liste les tâches de fond de ToolBox (rendus vidéo, envois YouTube, synchros) en cours, en attente ou en échec récemment.',
    examples: [
      'quels rendus sont en cours',
      'qu’est-ce qui tourne en ce moment',
      'les tâches en cours',
      'où en est le rendu',
    ],
    extract: () => ({}),
    risk: 'read',
    run: () => {
      const since = Date.now() - 24 * 3600 * 1000;
      const jobs = hub.jobs
        .list({ limit: 100 })
        .filter(
          (job) =>
            job.status === 'queued' ||
            job.status === 'running' ||
            ((job.status === 'failed' || job.status === 'interrupted') &&
              Date.parse(job.finishedAt ?? job.createdAt) >= since),
        )
        .map((job) => ({
          title: job.title,
          status: STATUS_LABELS[job.status] ?? job.status,
          progress: job.progress === null ? null : Math.round(job.progress * 100),
          error: job.error,
        }));
      const running = jobs.filter((job) => job.status === 'en cours').length;
      return {
        message:
          jobs.length === 0
            ? 'Aucune tâche en cours.'
            : `${running} tâche(s) en cours, ${jobs.length - running} autre(s) en attente ou en échec.`,
        data: { jobs },
      };
    },
  });

  define({
    name: 'list-modules',
    description: 'Liste les outils (modules) de ToolBox avec leur rôle.',
    examples: ['quels sont les outils', 'liste les outils de ToolBox'],
    extract: () => ({}),
    risk: 'read',
    run: () => {
      const modules = hub
        .moduleInfos()
        .filter((m) => m.status === 'loaded')
        .map((m) => ({ id: m.id, name: m.manifest.name, section: m.manifest.section }));
      return { message: `${modules.length} outils disponibles.`, data: { modules } };
    },
  });

  define({
    name: 'open',
    description:
      'Ouvre un outil de ToolBox (par son nom, ex. « Planning », « Stats YouTube », « To-do ») ou une page : accueil, tâches, fichiers générés, réglages, journaux.',
    parameters: {
      target: {
        type: 'string',
        description: 'Nom de l’outil ou de la page, ex. « Planning de sortie »',
      },
    },
    required: ['target'],
    examples: [
      'ouvre le planning',
      'ouvre les stats YouTube',
      'va dans la to-do',
      'ouvre les réglages',
    ],
    extract: (utterance) => {
      const target = extractName(utterance, OPEN_PREFIXES);
      return target ? { target } : null;
    },
    risk: 'read',
    run: (params) => {
      const wanted = normaliseWords(String(params.target));
      const page = SHELL_PAGES.find((p) => p.words.some((w) => wanted.includes(w)));
      if (page) return { message: `J’ouvre ${page.label}.`, open: page.route };
      const modules = hub.moduleInfos().filter((m) => m.status === 'loaded');
      const score = (name: string) => {
        const words = normaliseWords(name)
          .split(' ')
          .filter((w) => w.length > 2);
        return words.filter((w) => wanted.includes(w)).length / Math.max(1, words.length);
      };
      const best = modules
        .map((m) => ({
          m,
          s: Math.max(
            score(m.manifest.name),
            normaliseWords(m.id).replace(/ /g, '') === wanted.replace(/ /g, '') ? 1 : 0,
          ),
        }))
        .sort((a, b) => b.s - a.s)[0];
      if (!best || best.s === 0)
        throw new HttpError(404, `Aucun outil ne correspond à « ${String(params.target)} ».`);
      return { message: `J’ouvre ${best.m.manifest.name}.`, open: `/m/${best.m.id}` };
    },
  });
}
