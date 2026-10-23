// What the voice assistant may read from the statistics (MODULES.md §5.15):
// a channel summary, a track's figures, the highlights. Read only; the demo
// data are always announced as such.
import { HttpError, matchByName, type ModuleContext } from '@hub/sdk/backend';
import type { Dataset } from './dataset';
import type { LabResult } from './lab';
import type { Theory } from './theories';
import { overview, parseFilters, trackDetail, trackList } from './views';

/** 12345 → « 12 345 » (plain spaces: read correctly by the voice). */
const int = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const change = (now: number, before: number) => {
  if (before <= 0) return '';
  const pct = Math.round(((now - before) / before) * 100);
  return ` (${pct >= 0 ? '+' : ''}${pct} % par rapport à la période d’avant)`;
};

export function registerAssistantActions(
  ctx: ModuleContext,
  analysis: () => { data: Dataset; lab: LabResult; theories: Theory[] },
): void {
  const prefix = (data: Dataset) => (data.mode === 'demo' ? 'Données de démo : ' : '');
  const empty = (data: Dataset) => data.videos.length === 0;
  const noData = {
    message: 'Pas encore de statistiques : connecte le compte et synchronise depuis Stats YouTube.',
    data: { available: false },
  };

  ctx.assistant.define({
    name: 'channel-summary',
    description:
      'Résumé de la chaîne YouTube sur une période (7, 28 ou 90 derniers jours) : vues, heures regardées, abonnés, morceaux en tête, fait marquant.',
    parameters: {
      days: { type: 'string', description: 'Période en jours', enum: ['7', '28', '90'] },
    },
    risk: 'read',
    run: (params) => {
      const { data, lab, theories } = analysis();
      if (empty(data)) return noData;
      const days = String(params.days ?? '28');
      const view = overview(data, lab, theories, parseFilters({ period: days }), null);
      const k = view.key;
      const top = view.topTracks.slice(0, 3).map((t) => `${t.title} (${int(t.views)} vues)`);
      const message =
        `${prefix(data)}sur les ${days} derniers jours, ${int(k.views)} vues${change(k.views, k.viewsPrevious)}, ` +
        `${int(k.minutes / 60)} heures regardées, ${k.subsNet >= 0 ? '+' : ''}${int(k.subsNet)} abonnés` +
        `${k.subscribers !== null ? ` (${int(k.subscribers)} au total)` : ''}.` +
        `${top.length ? ` En tête : ${top.join(', ')}.` : ''}` +
        ` Données arrêtées au ${data.lastDay.split('-').reverse().join('/')} (YouTube a 2 à 3 jours de retard).`;
      return {
        message,
        data: {
          demo: data.mode === 'demo',
          days: Number(days),
          lastDay: data.lastDay,
          views: k.views,
          viewsPrevious: k.viewsPrevious,
          hoursWatched: Math.round(k.minutes / 60),
          subscribersNet: k.subsNet,
          subscribers: k.subscribers,
          shortsShare: k.shortsViewShare,
          topTracks: view.topTracks.slice(0, 5).map((t) => ({ title: t.title, views: t.views })),
          highlights: view.highlights.map((h) => h.text),
        },
      };
    },
  });

  ctx.assistant.define({
    name: 'track-stats',
    description:
      'Statistiques YouTube d’un morceau : vues de sa vidéo et de ses Shorts, meilleur élément.',
    parameters: { track: { type: 'string', description: 'Nom du morceau, même approximatif' } },
    required: ['track'],
    risk: 'read',
    run: (params) => {
      const { data, lab } = analysis();
      if (empty(data)) return noData;
      const tracks = trackList(data, lab);
      const match = matchByName(tracks, String(params.track), (t) => t.title);
      if (match.kind === 'none') {
        throw new HttpError(
          404,
          `Aucune vidéo YouTube liée à un morceau qui s’appelle « ${String(params.track)} ».`,
        );
      }
      if (match.kind === 'ambiguous') {
        throw new HttpError(
          409,
          `Plusieurs morceaux correspondent : ${match.items
            .slice(0, 4)
            .map((t) => t.title)
            .join(', ')}. Lequel ?`,
        );
      }
      const t = match.item;
      const detail = trackDetail(data, lab, t.trackId);
      const best = detail ? [...detail.elements].sort((a, b) => b.views - a.views)[0] : null;
      return {
        message:
          `${prefix(data)}${t.title} : ${int(t.views)} vues en tout (vidéo ${int(t.longViews)}, Shorts ${int(t.shortViews)}), ` +
          `${t.subsNet >= 0 ? '+' : ''}${int(t.subsNet)} abonnés.${best ? ` Meilleur élément : ${best.label} avec ${int(best.views)} vues.` : ''}`,
        data: {
          demo: data.mode === 'demo',
          track: t.title,
          release: t.release,
          views: t.views,
          longViews: t.longViews,
          shortViews: t.shortViews,
          subscribersNet: t.subsNet,
          elements:
            detail?.elements.map((e) => ({
              label: e.label,
              views: e.views,
              publishedAt: e.publishedAt,
            })) ?? [],
        },
      };
    },
  });

  ctx.assistant.define({
    name: 'highlights',
    description:
      'Faits marquants des statistiques YouTube du moment (vidéo au-dessus de l’habitude, pic, théorie solide).',
    risk: 'read',
    run: () => {
      const { data, lab, theories } = analysis();
      if (empty(data)) return noData;
      const view = overview(data, lab, theories, parseFilters({}), null);
      return {
        message: `${prefix(data)}${view.highlights.map((h) => h.text).join(' ')}`,
        data: {
          demo: data.mode === 'demo',
          highlights: view.highlights.map((h) => ({ title: h.title, text: h.text })),
        },
      };
    },
  });
}
