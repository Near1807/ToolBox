// Level 3 — Vidéos: every video, and the full sheet of one: all the metrics,
// compared with the usual at the same age, day by day, retention over the
// energy of the music, traffic sources, countries, devices, demographics.
import { useMemo, useState } from 'react';
import { Card, ErrorMessage, useApi, useModule, Icon } from '@hub/sdk/frontend';
import {
  AUDIO_MODE_LABELS,
  CONTENT_TYPE_LABELS,
  DEVICE_LABELS,
  EFFECT_LABELS,
  INTENSITY_LABELS,
  PLAYBACK_LABELS,
  TRAFFIC_LABELS,
} from '../shared';
import {
  BarList,
  fmtCompact,
  fmtDay,
  fmtInt,
  fmtNum,
  LineChart,
  RetentionChart,
  SERIES,
} from './charts';
import { filterQuery, Filters, IndexValue, kindLabel, Metric, type FilterValues } from './common';
import type { VideoDetailData, VideoListData } from './types';

type Sort = 'date' | 'views' | 'index' | 'pct';

/** Where the impressions / CTR of a video come from (API first, CSV for what it lacks). */
const REACH_SOURCES: Record<string, string> = {
  api: 'API YouTube Analytics',
  'api+csv': 'API YouTube Analytics, complétée par un import CSV',
  'csv-totals': 'export CSV de Studio (totaux à la date de l’export)',
  csv: 'export CSV de Studio (par jour)',
};
const DAY_SOURCES: Record<string, string> = {
  api: 'API YouTube Analytics',
  csv: 'import CSV de Studio',
  unknown: 'import CSV ou API (import d’avant la v0.18)',
};

export function Videos(props: {
  filters: FilterValues;
  onFilters: (f: FilterValues) => void;
  videoId: string | null;
  openVideo: (id: string | null) => void;
}) {
  const module = useModule();
  const list = useApi<VideoListData>(module.url(`/videos?${filterQuery(props.filters)}`));
  const [sort, setSort] = useState<Sort>('date');
  const rows = useMemo(() => {
    const items = [...(list.data?.videos ?? [])];
    const key = (v: (typeof items)[number]) =>
      sort === 'views'
        ? v.perf.views
        : sort === 'index'
          ? (v.perf.verdict?.index ?? -1)
          : sort === 'pct'
            ? (v.perf.avgViewPct ?? -1)
            : 0;
    if (sort !== 'date') items.sort((a, b) => key(b) - key(a));
    return items;
  }, [list.data, sort]);

  if (props.videoId) return <VideoSheet id={props.videoId} back={() => props.openVideo(null)} />;
  if (list.error) return <ErrorMessage>{list.error}</ErrorMessage>;
  return (
    <div className={list.loading ? 'ys-stale' : undefined}>
      <Filters
        value={props.filters}
        onChange={props.onFilters}
        tracks={list.data?.tracks}
        show={['kind', 'track']}
      />
      <Card title={`${rows.length} vidéo(s)`}>
        <table className="ys-table">
          <thead>
            <tr>
              <th>Vidéo</th>
              <th>
                <button
                  type="button"
                  className="ys-sort"
                  onClick={() => setSort('date')}
                  aria-pressed={sort === 'date'}
                >
                  Publiée
                </button>
              </th>
              <th className="num">
                <button
                  type="button"
                  className="ys-sort"
                  onClick={() => setSort('views')}
                  aria-pressed={sort === 'views'}
                >
                  <Metric k="views" />
                </button>
              </th>
              <th className="num">
                <button
                  type="button"
                  className="ys-sort"
                  onClick={() => setSort('index')}
                  aria-pressed={sort === 'index'}
                >
                  <Metric k="relativeIndex">vs d’habitude</Metric>
                </button>
              </th>
              <th className="num">
                <button
                  type="button"
                  className="ys-sort"
                  onClick={() => setSort('pct')}
                  aria-pressed={sort === 'pct'}
                >
                  <Metric k="avgViewPct">% regardé</Metric>
                </button>
              </th>
              <th className="num">
                <Metric k="halfLife" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ video, perf }) => (
              <tr key={video.id}>
                <td>
                  <button
                    type="button"
                    className="ys-link"
                    onClick={() => props.openVideo(video.id)}
                  >
                    {video.title}
                  </button>
                  <div className="small muted">
                    {kindLabel(video.kind)}
                    {video.origin.label ? ` · ${video.origin.label}` : ''}
                    {video.origin.trackId === null ? ' · non liée à un morceau' : ''}
                  </div>
                </td>
                <td className="nowrap">{fmtDay(video.publishedAt.slice(0, 10))}</td>
                <td className="num">{fmtInt(perf.views)}</td>
                <td className="num">
                  <IndexValue value={perf.verdict?.index} />
                  {perf.verdict && <span className="small muted"> J+{perf.verdict.age}</span>}
                </td>
                <td className="num">
                  {perf.avgViewPct === null ? '—' : `${fmtNum(perf.avgViewPct, 0)} %`}
                </td>
                <td className="num">{perf.halfLife === null ? '—' : `${perf.halfLife} j`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const LABELS: Record<string, Record<string, string>> = {
  traffic: TRAFFIC_LABELS,
  device: DEVICE_LABELS,
  playback: PLAYBACK_LABELS,
  content_type: CONTENT_TYPE_LABELS,
};

const BREAKDOWN_TITLES: Record<string, string> = {
  traffic: 'Sources de trafic',
  country: 'Pays',
  device: 'Appareils',
  playback: 'Où la vidéo est lue',
  age_gender: 'Âge et genre',
};

const AGE_LABELS: Record<string, string> = {
  'age13-17': '13–17',
  'age18-24': '18–24',
  'age25-34': '25–34',
  'age35-44': '35–44',
  'age45-54': '45–54',
  'age55-64': '55–64',
  'age65-': '65+',
};

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

function VideoSheet(props: { id: string; back: () => void }) {
  const module = useModule();
  const detail = useApi<VideoDetailData>(module.url(`/videos/${props.id}`));
  if (detail.error) return <ErrorMessage>{detail.error}</ErrorMessage>;
  const d = detail.data;
  if (!d) return <p className="muted">Calcul…</p>;
  const v = d.video;
  const t = d.totals;
  const tile = (key: string, value: string, label?: string, source?: string) => (
    <div className="ys-kpi" key={key} title={source ? `Source : ${source}` : undefined}>
      <div className="small muted">
        <Metric k={key}>{label}</Metric>
      </div>
      <div className="ys-kpi__value num">{value}</div>
      {source && <div className="small muted">{source}</div>}
    </div>
  );
  const consolidated =
    d.mode === 'demo'
      ? undefined
      : `API YouTube Analytics, jusqu’au ${fmtDay(d.days.at(-1) ?? '')}`;
  const reachSource = d.reachSource ? REACH_SOURCES[d.reachSource] : undefined;
  const ageGender = (() => {
    const rows = d.breakdowns.age_gender ?? [];
    const byAge = new Map<string, number>();
    const byGender = new Map<string, number>();
    for (const r of rows) {
      const [age, gender] = r.key.split('|');
      byAge.set(age!, (byAge.get(age!) ?? 0) + (r.pct ?? 0));
      byGender.set(gender!, (byGender.get(gender!) ?? 0) + (r.pct ?? 0));
    }
    return { byAge, byGender };
  })();
  const music = d.music?.music ?? null;
  return (
    <>
      <button type="button" className="button button--secondary button--small" onClick={props.back}>
        <Icon name="arrow-left" /> Toutes les vidéos
      </button>
      <Card title={v.title}>
        <p className="small muted">
          {kindLabel(v.kind)}
          {v.kindSource === 'duration' ? ' (deviné d’après la durée)' : ''} · publiée le{' '}
          {new Date(v.publishedAt).toLocaleString('fr-FR')} · {fmtNum(v.durationSec, 0)} s
          {d.track ? ` · morceau « ${d.track.title} »` : ' · non liée à un morceau'}
          {v.origin.label
            ? ` (${v.origin.label}${v.origin.link === 'manual' ? ', liée à la main' : ''})`
            : ''}
          {d.mode === 'real' && (
            <>
              {' · '}
              <a
                href={`https://www.youtube.com/${v.kind === 'short' ? 'shorts/' : 'watch?v='}${v.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Voir sur YouTube <Icon name="external-link" size="0.95em" />
              </a>
            </>
          )}
        </p>
        {v.origin.source === 'custom-reel' && (
          <p className="small">
            Reel perso : {EFFECT_LABELS[v.origin.effect ?? ''] ?? '—'}, intensité{' '}
            {INTENSITY_LABELS[v.origin.intensity ?? ''] ?? '—'},{' '}
            {AUDIO_MODE_LABELS[v.origin.audioMode ?? ''] ?? '—'}
          </p>
        )}
        <div className="ys-kpis">
          {tile('views', fmtInt(t.views), undefined, consolidated)}
          {t.engagedViews !== null && tile('engagedViews', fmtInt(t.engagedViews))}
          {tile('minutes', `${fmtNum((t.minutes ?? 0) / 60, 1)} h`)}
          {tile(
            'avgViewDuration',
            t.avgViewDuration === null ? '—' : `${fmtNum(t.avgViewDuration, 0)} s`,
          )}
          {tile('avgViewPct', t.avgViewPct === null ? '—' : `${fmtNum(t.avgViewPct, 0)} %`)}
          {tile('likes', fmtInt(t.likes))}
          {tile('comments', fmtInt(t.comments))}
          {tile('shares', fmtInt(t.shares))}
          {tile('subsGained', fmtInt(t.subsGained))}
          {tile('subsLost', fmtInt(t.subsLost))}
          {tile('subsPer1000', fmtNum(t.subsPer1000, 1))}
          {tile('halfLife', t.halfLife === null ? '—' : `${t.halfLife} j`)}
          {tile(
            'impressions',
            t.impressions === null ? '—' : fmtInt(t.impressions),
            undefined,
            reachSource,
          )}
          {tile('ctr', t.ctr === null ? '—' : `${fmtNum(t.ctr, 1)} %`, undefined, reachSource)}
        </div>
        {(t.impressions === null || t.ctr === null) && (
          <p className="small muted">
            Impressions et taux de clics : non fournis par l’API pour cette vidéo. Importe l’export
            CSV de YouTube Studio (onglet « Données ») pour les avoir.
          </p>
        )}
      </Card>

      <Card title={<Metric k="relativeIndex">Par rapport à d’habitude, au même âge</Metric>}>
        <table className="ys-table">
          <thead>
            <tr>
              <th>Âge</th>
              <th className="num">Vues de la vidéo</th>
              <th className="num">Ta médiane ({kindLabel(v.kind).toLowerCase()}s)</th>
              <th className="num">Indice</th>
            </tr>
          </thead>
          <tbody>
            {[1, 3, 7, 30].map((age) => (
              <tr key={age}>
                <td>J+{age}</td>
                <td className="num">{fmtInt(d.perf.viewsAt[age])}</td>
                <td className="num">{fmtInt(d.usual[age] as number | null)}</td>
                <td className="num">
                  <IndexValue value={d.perf.index[age]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Médiane des autres {v.kind === 'short' ? 'Shorts' : 'vidéos longues'} assez anciennes (au
          moins 3 pour comparer).
          {d.perf.startSpeed !== null
            ? ` Démarrage : ${fmtNum(d.perf.startSpeed * 100, 0)} % des vues de J+7 faites à J+1.`
            : ''}
          {d.perf.evergreen ? ' Vidéo qui dure (evergreen).' : ''}
        </p>
      </Card>

      <Card title="Jour par jour">
        <LineChart
          ariaLabel="Vues par jour de la vidéo"
          x={d.days}
          series={[
            {
              key: 'views',
              label: 'Vues',
              values: d.series.views,
              color: v.kind === 'short' ? SERIES.short : SERIES.video,
              dashed: v.kind !== 'short',
            },
          ]}
          note={() => (consolidated ? `Source : ${consolidated} (consolidé)` : null)}
          marks={d.anomalies.map((a) => ({
            index: d.days.indexOf(a.day),
            label: `${a.kind === 'spike' ? 'Pic' : 'Creux'} inhabituel (attendu ~${fmtInt(a.expected)})`,
          }))}
        />
        {d.series.ctr.some((x) => x !== null) && (
          <LineChart
            ariaLabel="Taux de clics des impressions par jour"
            x={d.days}
            series={[
              {
                key: 'ctr',
                label: 'Taux de clics (%)',
                values: d.series.ctr,
                color: 'var(--accent)',
              },
            ]}
            height={150}
            format={(n) => `${fmtNum(n, 1)} %`}
            note={(i) => {
              const source = d.series.reachSource[i];
              return source ? `Source : ${DAY_SOURCES[source] ?? source}` : null;
            }}
          />
        )}
      </Card>

      <Card title="Rétention × musique">
        {!d.retention || d.retention.length === 0 ? (
          <p className="muted">
            YouTube ne donne pas encore de courbe de rétention pour cette vidéo (trop peu de vues).
          </p>
        ) : (
          <>
            <RetentionChart
              points={d.retention}
              energy={music?.energy ?? null}
              sections={music?.sections ?? []}
              events={d.music?.events ?? []}
              durationSec={music ? music.duration : v.durationSec}
              trackStart={music?.start ?? 0}
            />
            {!music && (
              <p className="small muted">
                {v.origin.trackId === null
                  ? 'Lie cette vidéo à son morceau (onglet « Données ») pour voir l’énergie de la musique.'
                  : 'Énergie du morceau pas encore calculée (à la prochaine synchronisation), ou extrait inconnu.'}
              </p>
            )}
            {d.music && d.music.events.length > 0 && (
              <ul className="ys-events">
                {d.music.events.map((e, i) => (
                  <li key={i}>
                    {e.kind === 'drop' ? '▼ Décrochage' : '▲ Re-visionnage'} à{' '}
                    {fmtNum(e.ratio * 100, 0)} %{e.section ? ` (${e.section})` : ''} :{' '}
                    {e.change > 0 ? '+' : ''}
                    {fmtNum(e.change * 100, 1)} pt
                  </li>
                ))}
              </ul>
            )}
            {d.music?.energyLink && (
              <p className="small muted">
                Lien entre énergie et perte d’audience sur cette vidéo : ρ ={' '}
                {fmtNum(d.music.energyLink.rho, 2)} (
                {d.music.energyLink.rho > 0.2
                  ? 'on décroche moins quand la musique est énergique'
                  : d.music.energyLink.rho < -0.2
                    ? 'on décroche plus quand la musique est énergique'
                    : 'pas de lien net'}
                ). Une seule vidéo : à prendre comme une indication, la tendance générale est dans
                le Labo. Sections estimées d’après l’énergie seulement.
              </p>
            )}
          </>
        )}
      </Card>

      <div className="ys-two">
        {(['traffic', 'country', 'device', 'playback'] as const).map((kind) => {
          const rows = d.breakdowns[kind] ?? [];
          if (rows.length === 0) return null;
          const total = rows.reduce((sum, r) => sum + r.views, 0) || 1;
          return (
            <Card key={kind} title={BREAKDOWN_TITLES[kind]}>
              <BarList
                rows={rows.slice(0, 10).map((r) => ({
                  key: r.key,
                  label: kind === 'country' ? countryName(r.key) : (LABELS[kind]?.[r.key] ?? r.key),
                  value: (r.views / total) * 100,
                  hint: `${fmtInt(r.views)} vues${r.minutes !== null ? ` · ${fmtNum(r.minutes / 60, 1)} h` : ''}`,
                }))}
                format={(n) => `${fmtNum(n, 0)} %`}
              />
            </Card>
          );
        })}
        <Card title={BREAKDOWN_TITLES.age_gender}>
          {ageGender.byAge.size === 0 ? (
            <p className="muted">
              Masqué par YouTube sous un certain volume de vues (protection de la vie privée).
            </p>
          ) : (
            <>
              <BarList
                rows={[...ageGender.byAge.entries()].map(([age, pct]) => ({
                  key: age,
                  label: AGE_LABELS[age] ?? age,
                  value: pct,
                }))}
                format={(n) => `${fmtNum(n, 0)} %`}
              />
              <p className="small muted">
                {[...ageGender.byGender.entries()]
                  .map(
                    ([g, pct]) =>
                      `${g === 'male' ? 'Hommes' : g === 'female' ? 'Femmes' : 'Autre / non précisé'} ${fmtNum(pct, 0)} %`,
                  )
                  .join(' · ')}
              </p>
            </>
          )}
        </Card>
      </div>
      <p className="small muted">
        Vues de la fiche : {fmtCompact(t.views ?? 0)} d’après l’API Analytics (compteur public :{' '}
        {fmtInt(v.totalViews)}).
      </p>
    </>
  );
}
