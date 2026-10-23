// Level 1 — Vue d'ensemble: key figures of the channel, their evolution, what
// moved since the last visit, the three highlights of the moment, top tracks,
// personal records.
import { useEffect, useRef } from 'react';
import { Card, ErrorMessage, useApi, useModule } from '@hub/sdk/frontend';
import { fmtCompact, fmtDay, fmtInt, fmtNum, LineChart, SERIES } from './charts';
import { filterQuery, Filters, Kpi, Metric, type FilterValues } from './common';
import type { OverviewData } from './types';

export function Overview(props: {
  filters: FilterValues;
  onFilters: (f: FilterValues) => void;
  openVideo: (id: string) => void;
  openTrack: (id: number) => void;
}) {
  const module = useModule();
  const data = useApi<OverviewData>(module.url(`/overview?${filterQuery(props.filters)}`));
  const marked = useRef(false);
  // The visit is recorded after the page was shown (« depuis ta dernière visite »).
  useEffect(() => {
    if (!data.data || marked.current) return;
    marked.current = true;
    const timer = setTimeout(() => void module.api.post('/visit').catch(() => {}), 4000);
    return () => clearTimeout(timer);
  }, [data.data, module.api]);

  if (data.error) return <ErrorMessage>{data.error}</ErrorMessage>;
  const d = data.data;
  if (!d) return <p className="muted">Calcul des statistiques…</p>;
  const k = d.key;
  const marks = d.series.publications.map((p) => ({
    index: d.series.days.indexOf(p.day),
    label: `${p.kind === 'short' ? 'Short' : 'Vidéo'} publié : ${p.label ? `${p.label} — ` : ''}${p.title}`,
  }));
  const subscribers = d.series.subscribers;
  const showSubscribers = subscribers.filter((v) => v !== null).length > 2;

  return (
    <div className={data.loading ? 'ys-stale' : undefined}>
      <Filters value={props.filters} onChange={props.onFilters} />
      <div className="ys-kpis">
        <Kpi
          label={<Metric k="subscribers" />}
          value={fmtInt(k.subscribers)}
          hint={
            k.subscribersDelta !== null
              ? `${k.subscribersDelta >= 0 ? '+' : ''}${fmtInt(k.subscribersDelta)} sur la période`
              : undefined
          }
        />
        <Kpi
          label={<Metric k="views">Vues</Metric>}
          value={fmtInt(k.views)}
          delta={{ value: k.views, previous: k.viewsPrevious }}
        />
        <Kpi
          label={<Metric k="minutes">Heures regardées</Metric>}
          value={fmtNum(k.minutes / 60, 0)}
          delta={{ value: k.minutes, previous: k.minutesPrevious }}
        />
        <Kpi
          label={<Metric k="subsNet" />}
          value={`${k.subsNet >= 0 ? '+' : ''}${fmtInt(k.subsNet)}`}
          delta={{ value: k.subsNet, previous: k.subsNetPrevious }}
        />
        <Kpi
          label={<Metric k="avgViewPct" />}
          value={k.avgViewPct === null ? '—' : `${fmtNum(k.avgViewPct, 0)} %`}
        />
        <Kpi
          label="Part des Shorts dans les vues"
          value={k.shortsViewShare === null ? '—' : `${fmtNum(k.shortsViewShare * 100, 0)} %`}
          hint={`${k.shorts} Short(s), ${k.videos - k.shorts} vidéo(s) longue(s)`}
        />
      </div>

      <div className="ys-highlights">
        {d.highlights.map((h, i) => (
          <button
            key={i}
            type="button"
            className={`ys-highlight ys-highlight--${h.tone}`}
            onClick={() => h.videoId && props.openVideo(h.videoId)}
            disabled={!h.videoId}
          >
            <strong>{h.title}</strong>
            <span>{h.text}</span>
          </button>
        ))}
      </div>

      <Card title={`Vues par jour — du ${fmtDay(d.period.first)} au ${fmtDay(d.period.last)}`}>
        <LineChart
          ariaLabel="Vues par jour des Shorts et des vidéos longues"
          x={d.series.days}
          series={[
            { key: 'short', label: 'Shorts', values: d.series.shorts, color: SERIES.short },
            {
              key: 'video',
              label: 'Vidéos longues',
              values: d.series.long,
              color: SERIES.video,
              dashed: true,
            },
          ]}
          marks={marks.filter((m) => m.index >= 0)}
        />
        <p className="small muted">
          Traits verticaux : publications. Les données YouTube s’arrêtent au {fmtDay(d.lastDay)} (2
          à 3 jours de retard).
        </p>
      </Card>

      <div className="ys-two">
        {showSubscribers && (
          <Card title={<Metric k="subscribers">Abonnés</Metric>}>
            <LineChart
              ariaLabel="Abonnés par jour"
              x={d.series.days}
              series={[
                { key: 'subs', label: 'Abonnés', values: subscribers, color: 'var(--accent)' },
              ]}
              height={180}
              format={fmtCompact}
            />
          </Card>
        )}
        <Card title="Top morceaux de la période">
          {d.topTracks.length === 0 && (
            <p className="muted">Aucune vidéo liée à un morceau sur la période.</p>
          )}
          <ul className="ys-rank">
            {d.topTracks.map((t, i) => (
              <li key={t.trackId}>
                <button
                  type="button"
                  className="ys-link"
                  onClick={() => props.openTrack(t.trackId)}
                >
                  <span className="ys-rank__n">{i + 1}</span>
                  <strong>{t.title}</strong>
                </button>
                <span className="num">{fmtInt(t.views)} vues</span>
                <span className="small muted">
                  Shorts {fmtInt(t.shorts)} · vidéo {fmtInt(t.long)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="ys-two">
        <Card title="Depuis ta dernière visite">
          {!d.sinceVisit && (
            <p className="muted">
              Première visite : la prochaine fois, ce qui a bougé s’affichera ici.
            </p>
          )}
          {d.sinceVisit && (
            <>
              <p className="small muted">
                Dernière visite : {new Date(d.sinceVisit.at).toLocaleString('fr-FR')}
              </p>
              {d.sinceVisit.items.length === 0 && d.sinceVisit.newRecords.length === 0 && (
                <p className="muted">Rien n’a bougé.</p>
              )}
              <ul className="ys-moves">
                {d.sinceVisit.items.map((item, i) => (
                  <li key={i}>
                    <span>{item.label}</span>
                    <span className="num">
                      {fmtInt(item.before)} → <strong>{fmtInt(item.after)}</strong>{' '}
                      <span className="ys-up">(+{fmtInt(item.after - item.before)})</span>
                    </span>
                  </li>
                ))}
                {d.sinceVisit.newRecords.map((r) => (
                  <li key={r.key}>
                    <span>🏆 Nouveau : {r.label}</span>
                    <span>{r.value}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="Records et jalons">
          <ul className="ys-records">
            {d.records.map((r) => (
              <li key={r.key}>
                <span className="small muted">{r.label}</span>
                {r.videoId ? (
                  <button
                    type="button"
                    className="ys-link"
                    onClick={() => props.openVideo(r.videoId!)}
                  >
                    {r.value}
                  </button>
                ) : (
                  <span>{r.value}</span>
                )}
                {r.date && <span className="small muted">{fmtDay(r.date)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
