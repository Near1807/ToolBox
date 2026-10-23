// Level 2 — Morceaux: each track brings its long video and its Shorts (and
// Reels perso published as Shorts) together: total, share of each element, and
// the release timeline (Monday → Friday) over the daily views.
import { Card, EmptyState, ErrorMessage, TrackList, useApi, useModule } from '@hub/sdk/frontend';
import { WEEKDAYS } from '../shared';
import { BarList, Columns, fmtDay, fmtInt, fmtNum, LineChart, SERIES } from './charts';
import { IndexValue, Metric, TierBadge } from './common';
import type { TrackDetailData, TrackListData } from './types';

export function Tracks(props: {
  trackId: number | null;
  openTrack: (id: number | null) => void;
  openVideo: (id: string) => void;
}) {
  const module = useModule();
  const list = useApi<TrackListData>(module.url('/tracks'));
  if (list.error) return <ErrorMessage>{list.error}</ErrorMessage>;
  if (!list.data) return <p className="muted">Calcul…</p>;
  if (list.data.tracks.length === 0) {
    return (
      <EmptyState title="Aucune vidéo liée à un morceau.">
        Les vidéos envoyées par le Planning de sortie sont liées toutes seules ; les autres se lient
        à la main dans l’onglet « Données ».
      </EmptyState>
    );
  }
  const selected = props.trackId ?? list.data.tracks[0]!.trackId;
  return (
    <TrackList
      tracks={list.data.tracks.map((t) => ({ ...t, id: t.trackId }))}
      selected={selected}
      onSelect={(id) => props.openTrack(id)}
      detail={(t) =>
        `${fmtInt(t.views)} vues · ${t.videos} vidéo(s)${t.index7 !== null ? ` · ×${fmtNum(t.index7, 2)} à J+7` : ''}`
      }
    >
      <TrackSheet key={selected} trackId={selected} openVideo={props.openVideo} />
    </TrackList>
  );
}

function TrackSheet(props: { trackId: number; openVideo: (id: string) => void }) {
  const module = useModule();
  const detail = useApi<TrackDetailData>(module.url(`/tracks/${props.trackId}`));
  if (detail.error) return <ErrorMessage>{detail.error}</ErrorMessage>;
  const d = detail.data;
  if (!d) return <p className="muted">Calcul…</p>;
  const shorts = d.elements.filter((e) => e.kind === 'short');
  const long = d.elements.find((e) => e.kind === 'video');
  const sum = (index: number) => shorts.reduce((total, e) => total + (e.daily[index] ?? 0), 0);
  const marks = d.elements.map((e) => ({
    index: d.days.indexOf(e.publishDay),
    label: `${e.label} publié (${WEEKDAYS[(new Date(`${e.publishDay}T12:00:00Z`).getUTCDay() + 6) % 7]})`,
  }));
  return (
    <>
      <Card title={d.track ? `${d.track.title} — ${d.track.artist}` : 'Morceau'}>
        <div className="ys-kpis ys-kpis--small">
          <div className="ys-kpi">
            <div className="small muted">Vues au total</div>
            <div className="ys-kpi__value num">{fmtInt(d.total)}</div>
          </div>
          <div className="ys-kpi">
            <div className="small muted">Vidéo longue</div>
            <div className="ys-kpi__value num">{fmtInt(long?.views ?? 0)}</div>
          </div>
          <div className="ys-kpi">
            <div className="small muted">Shorts ({shorts.length})</div>
            <div className="ys-kpi__value num">
              {fmtInt(shorts.reduce((t, e) => t + e.views, 0))}
            </div>
          </div>
          <div className="ys-kpi">
            <div className="small muted">Sortie</div>
            <div className="ys-kpi__value">{fmtDay(d.release)}</div>
          </div>
        </div>
        <LineChart
          ariaLabel="Vues par jour autour de la sortie"
          x={d.days}
          series={[
            {
              key: 'short',
              label: 'Shorts (total)',
              values: d.days.map((_, i) => sum(i)),
              color: SERIES.short,
            },
            ...(long
              ? [
                  {
                    key: 'video',
                    label: 'Vidéo longue',
                    values: long.daily,
                    color: SERIES.video,
                    dashed: true,
                  },
                ]
              : []),
          ]}
          marks={marks.filter((m) => m.index >= 0)}
        />
        <p className="small muted">
          Traits verticaux : chaque publication de la sortie (survole le graphique pour les voir).
        </p>
      </Card>

      <div className="ys-two">
        <Card title="Répartition des vues">
          <BarList
            rows={d.elements.map((e) => ({
              key: e.id,
              label: e.label,
              value: e.views,
              hint: e.title,
            }))}
            color="var(--series-1)"
          />
        </Card>
        <Card title="Effet rabatteur sur ce morceau">
          {!d.lag || !d.lag.lag ? (
            <p className="muted">
              Pas assez de jours (ou pas de vidéo longue et de Shorts) pour mesurer un décalage.
            </p>
          ) : (
            <>
              <p>
                Corrélation entre les variations des vues des Shorts et celles de la vidéo longue,
                selon le décalage : <TierBadge confidence={d.lag.confidence} />
              </p>
              <Columns
                ariaLabel="Corrélation selon le décalage en jours"
                labels={d.lag.lag.byLag.map((l) => `J+${l.lag}`)}
                values={d.lag.lag.byLag.map((l) => l.r)}
                highlight={d.lag.lag.best.lag}
              />
              <p className="small muted">
                Meilleur décalage : {d.lag.lag.best.lag} jour(s), r = {fmtNum(d.lag.lag.best.r, 2)}
                {d.lag.fromOwnShorts > 0
                  ? ` · ${fmtInt(d.lag.fromOwnShorts)} vues de la vidéo venues des Shorts du morceau (suggestions)`
                  : ''}
                . Une corrélation n’est pas une preuve de cause.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card title="Éléments de la sortie">
        <table className="ys-table">
          <thead>
            <tr>
              <th>Élément</th>
              <th>Publié</th>
              <th className="num">
                <Metric k="views" />
              </th>
              <th className="num">
                <Metric k="relativeIndex">J+7 vs d’habitude</Metric>
              </th>
              <th className="num">
                <Metric k="avgViewPct">% regardé</Metric>
              </th>
              <th>Extrait / style</th>
            </tr>
          </thead>
          <tbody>
            {d.elements.map((e) => (
              <tr key={e.id}>
                <td>
                  <button type="button" className="ys-link" onClick={() => props.openVideo(e.id)}>
                    {e.label}
                  </button>
                </td>
                <td>
                  {WEEKDAYS[(new Date(`${e.publishDay}T12:00:00Z`).getUTCDay() + 6) % 7]}{' '}
                  {fmtDay(e.publishDay)}
                </td>
                <td className="num">{fmtInt(e.views)}</td>
                <td className="num">
                  <IndexValue value={e.index7} />
                </td>
                <td className="num">
                  {e.avgViewPct === null ? '—' : `${fmtNum(e.avgViewPct, 0)} %`}
                </td>
                <td className="small muted">
                  {e.origin.excerptStart !== null
                    ? `${fmtNum(e.origin.excerptStart, 0)} s → +${fmtNum(e.origin.excerptDuration, 0)} s`
                    : ''}
                  {e.origin.source === 'custom-reel'
                    ? ` · Reel perso${e.origin.effect ? ` (${e.origin.effect})` : ''}`
                    : ''}
                  {e.origin.source === 'cover-reel' ? ' · Reel de la cover' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
