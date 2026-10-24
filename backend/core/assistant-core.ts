import {
  extractName,
  HttpError,
  matchByName,
  NotFoundError,
  type AssistantActionDefinition,
} from '../../packages/sdk/backend';
import type { Hub } from './hub';

// Actions of the hub itself (module id "core"): tasks in progress, list of the
// tools, and navigation (open a tool or a page of the shell).

const SHELL_PAGES: { route: string; label: string; words: string[] }[] = [
  { route: '/', label: 'l’accueil', words: ['accueil', 'home', 'debut'] },
  // Not « tâches » alone: that is the To-do (« ouvre mes tâches »).
  {
    route: '/jobs',
    label: 'les tâches en cours',
    words: ['taches en cours', 'taches de fond', 'rendus', 'jobs', 'file d attente'],
  },
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

/** The app itself (« ouvre l'application ») rather than one of its tools. */
const APP_WORDS = /^(?:l |la |le )?(?:application|app|appli|toolbox|tool box|fenetre|fenêtre)$/i;

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

  type Target = { route: string; label: string; names: string[] };
  /** Pages of the shell and loaded tools, with their nicknames (set by the assistant). */
  const targets = (): Target[] => {
    const nicknames = hub.assistant.toolNicknames();
    return [
      ...SHELL_PAGES.map((p) => ({
        route: p.route,
        label: p.label,
        names: [
          p.label.replace(/^(?:l’|les |la |le )/, ''),
          ...p.words,
          ...(nicknames[p.route] ?? []),
        ],
      })),
      ...hub
        .moduleInfos()
        .filter((m) => m.status === 'loaded')
        .map((m) => ({
          route: `/m/${m.id}`,
          label: m.manifest.name,
          names: [m.manifest.name, m.id.replace(/-/g, ' '), ...(nicknames[m.id] ?? [])],
        })),
    ];
  };
  /** A page or a tool from what was said (spelling, sound, nicknames). */
  const findTarget = (said: string): Target => {
    const match = matchByName(targets(), said, (t) => t.names);
    if (match.kind === 'match') return match.item;
    if (match.kind === 'ambiguous')
      throw new HttpError(
        409,
        `Plusieurs outils correspondent : ${match.items
          .slice(0, 4)
          .map((t) => t.label)
          .join(', ')}. Lequel ?`,
      );
    throw new NotFoundError(
      'target',
      'l’outil',
      said,
      match.suggestions.map((t) => t.label),
    );
  };

  define({
    name: 'open',
    label: 'Ouvrir un outil ou une page',
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
      // « ouvre l'application » is show-app, not a tool.
      if (!target || APP_WORDS.test(target)) return null;
      return { target };
    },
    risk: 'read',
    run: (params) => {
      const target = findTarget(String(params.target));
      return { message: `J’ouvre ${target.label}.`, open: target.route };
    },
  });

  // « ouvre l'application » : the main window shown and brought to the front
  // (restored when minimised or in the notification area), on a page if asked.
  define({
    name: 'show-app',
    label: 'Afficher l’application',
    description:
      'Affiche la fenêtre de ToolBox au premier plan (restaurée si réduite ou cachée), sur l’accueil ou sur la page demandée.',
    parameters: {
      target: { type: 'string', description: 'Page ou outil à ouvrir (facultatif)' },
    },
    examples: [
      'ouvre l’application',
      'ouvre ToolBox',
      'montre l’application',
      'affiche la fenêtre',
      'reviens sur l’app',
    ],
    extract: (utterance) => {
      const said = normaliseWords(utterance);
      if (!/\b(?:application|app|toolbox|tool box|fenetre)\b/.test(said)) return null;
      // « ouvre l'application sur le planning » → the page.
      const page = /\b(?:sur|dans|a|au)\s+(?:l |le |la |les )?(.+)$/.exec(said);
      return page && !APP_WORDS.test(page[1]!) ? { target: page[1]! } : {};
    },
    risk: 'read',
    run: (params) => {
      if (!params.target) return { message: 'C’est ouvert.', open: '/' };
      const target = findTarget(String(params.target));
      return { message: 'C’est ouvert.', open: target.route };
    },
  });
}
