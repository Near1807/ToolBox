// Level 4 — Labo: cross-analyses of the statistics with what ToolBox knows.
// Each block says what it measures, how, and how sure it is (tier badge).
import { useState } from 'react';
import { Card, ErrorMessage, useApi, useModule } from '@hub/sdk/frontend';
import { WEEKDAYS } from '../shared';
import {
  BarList,
  fmtDay,
  fmtInt,
  fmtNum,
  GrowthChart,
  Heatmap,
  Legend,
  Scatter,
  SERIES,
} from './charts';
import { IndexValue, kindLabel, Metric, TierBadge } from './common';
import type { LabData } from './types';

const HOURS = ['0–6 h', '6–12 h', '12–18 h', '18–24 h'];

function Section(props: { id: string; title: string; what: string; children: React.ReactNode }) {
  return (
    <section className="ys-lab" id={`lab-${props.id}`}>
      <h2>{props.title}</h2>
      <p className="small muted">{props.what}</p>
      {props.children}
    </section>
  );
}

export function Lab(props: { openVideo: (id: string) => void; openTrack: (id: number) => void }) {
  const module = useModule();
  const lab = useApi<LabData>(module.url('/lab'));
  const [kind, setKind] = useState<'short' | 'video'>('short');
  if (lab.error) return <ErrorMessage>{lab.error}</ErrorMessage>;
  const d = lab.data;
  if (!d) return <p className="muted">Calcul du Labo…</p>;
  const growth = d.growth.find((g) => g.kind === kind)!;
  const heat = d.heatmap.find((h) => h.kind === kind)!;
  const weekdays = d.weekdays.find((w) => w.kind === kind)!;
  const videos = d.videos.filter((v) => v.kind === kind && v.verdict);
  const best = [...videos].sort((a, b) => b.verdict!.index - a.verdict!.index);
  const kindSwitch = (
    <div className="ys-segmented" role="group" aria-label="Type de vidéo">
      {(['short', 'video'] as const).map((k) => (
        <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
          {k === 'short' ? 'Shorts' : 'Vidéos longues'}
        </button>
      ))}
    </div>
  );
  return (
    <div className="ys-labs">
      <p className="ys-sourceline small muted">
        <strong>Données consolidées</strong> — YouTube Analytics, disponibles jusqu’au{' '}
        {fmtDay(d.lastDay)} : les analyses ne voient pas les jours plus récents.
      </p>
      <nav className="ys-toc small">
        {[
          ['perf', 'Performance relative'],
          ['rabatteur', 'Effet rabatteur'],
          ['excerpts', 'Meilleurs extraits'],
          ['styles', 'Styles'],
          ['when', 'Jour et heure'],
          ['conversion', 'Conversion'],
          ['life', 'Cycle de vie'],
          ['anomalies', 'Anomalies'],
          ['music', 'Rétention × musique'],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#lab-${id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(`lab-${id}`)?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            {label}
          </a>
        ))}
      </nav>

      <Section
        id="perf"
        title="Performance relative"
        what="Chaque vidéo comparée à TA médiane au même âge (J+1, J+3, J+7, J+30), pour le même type. Les courbes sont normalisées : 1 = les vues habituelles à J+7."
      >
        {kindSwitch}
        <div className="ys-two">
          <Card title="Courbes de croissance (30 premiers jours)">
            <GrowthChart
              curves={growth.curves}
              usual={growth.usual}
              color={kind === 'short' ? SERIES.short : SERIES.video}
            />
          </Card>
          <Card title="Ta médiane au même âge">
            <table className="ys-table">
              <thead>
                <tr>
                  <th>Âge</th>
                  <th className="num">Vues médianes</th>
                  <th className="num">Sur</th>
                </tr>
              </thead>
              <tbody>
                {d.usual
                  .filter((u) => u.kind === kind)
                  .map((u) => (
                    <tr key={u.age}>
                      <td>J+{u.age}</td>
                      <td className="num">{fmtInt(u.median)}</td>
                      <td className="num small muted">{u.n} vidéo(s)</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <h3 className="small">Mieux que d’habitude</h3>
            <ul className="ys-rank">
              {best.slice(0, 3).map((v) => (
                <li key={v.id}>
                  <button type="button" className="ys-link" onClick={() => props.openVideo(v.id)}>
                    {v.title}
                  </button>
                  <IndexValue value={v.verdict!.index} />
                  <span className="small muted">J+{v.verdict!.age}</span>
                </li>
              ))}
            </ul>
            <h3 className="small">Moins bien que d’habitude</h3>
            <ul className="ys-rank">
              {best
                .slice(-3)
                .reverse()
                .map((v) => (
                  <li key={v.id}>
                    <button type="button" className="ys-link" onClick={() => props.openVideo(v.id)}>
                      {v.title}
                    </button>
                    <IndexValue value={v.verdict!.index} />
                    <span className="small muted">J+{v.verdict!.age}</span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section
        id="rabatteur"
        title="Effet rabatteur des Shorts"
        what="Quand les Shorts d’un morceau prennent des vues, la vidéo longue en gagne-t-elle les jours suivants ? Corrélation des variations quotidiennes (log) avec un décalage de 0 à 7 jours, testée contre des séries décalées au hasard (permutations). Les vues venues des Shorts eux-mêmes (suggestions) sont comptées quand YouTube les donne."
      >
        <Card
          title={
            <>
              Sur l’ensemble des morceaux <TierBadge confidence={d.rabatteur.overall.confidence} />
            </>
          }
        >
          <p>
            Corrélation moyenne au meilleur décalage :{' '}
            <strong>{fmtNum(d.rabatteur.overall.meanR, 2)}</strong>
            {d.rabatteur.overall.bestLag !== null
              ? ` · décalage le plus fréquent : ${d.rabatteur.overall.bestLag} jour(s)`
              : ''}
            .
          </p>
          <table className="ys-table">
            <thead>
              <tr>
                <th>Morceau</th>
                <th className="num">Vues Shorts</th>
                <th className="num">Vues vidéo</th>
                <th className="num">Meilleur décalage</th>
                <th className="num">r</th>
                <th className="num">Venues des Shorts</th>
                <th>Confiance</th>
              </tr>
            </thead>
            <tbody>
              {d.rabatteur.tracks.map((t) => (
                <tr key={t.trackId}>
                  <td>
                    <button
                      type="button"
                      className="ys-link"
                      onClick={() => props.openTrack(t.trackId)}
                    >
                      {t.title}
                    </button>
                  </td>
                  <td className="num">{fmtInt(t.shortsViews)}</td>
                  <td className="num">{fmtInt(t.longViews)}</td>
                  <td className="num">{t.lag ? `J+${t.lag.best.lag}` : '—'}</td>
                  <td className="num">{t.lag ? fmtNum(t.lag.best.r, 2) : '—'}</td>
                  <td className="num">{fmtInt(t.fromOwnShorts)}</td>
                  <td>
                    <TierBadge confidence={t.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section
        id="excerpts"
        title="Meilleurs extraits"
        what="Les Shorts comparés selon leur extrait : énergie moyenne de l’extrait (forme d’onde du morceau) et position dans le morceau, contre la rétention et les vues. Corrélation de Spearman, p-value par permutations."
      >
        <div className="ys-two">
          <Card
            title={
              <>
                Énergie de l’extrait → % regardé{' '}
                {d.excerpts.energyVsRetention && (
                  <TierBadge confidence={d.excerpts.energyVsRetention.confidence} />
                )}
              </>
            }
          >
            <Scatter
              xLabel="Énergie moyenne de l’extrait"
              yLabel="% regardé"
              points={d.excerpts.list
                .filter((e) => e.energy !== null && e.avgViewPct !== null)
                .map((e) => ({
                  x: e.energy!,
                  y: e.avgViewPct!,
                  label: `${e.trackTitle} — ${e.label ?? e.title}`,
                  detail: `Énergie ${fmtNum(e.energy! * 100, 0)} % · ${fmtNum(e.avgViewPct, 0)} % regardé · extrait à ${fmtNum(e.start, 0)} s`,
                }))}
              xFormat={(n) => `${fmtNum(n * 100, 0)} %`}
              yFormat={(n) => `${fmtNum(n, 0)} %`}
            />
            {d.excerpts.energyVsRetention && (
              <p className="small muted">
                ρ = {fmtNum(d.excerpts.energyVsRetention.rho, 2)} ·{' '}
                {d.excerpts.energyVsRetention.confidence.reason}
              </p>
            )}
          </Card>
          <Card title="Autres liens">
            <ul className="ys-findings">
              {[
                ['Énergie de l’extrait → vues (indice J+7)', d.excerpts.energyVsViews],
                ['Position de l’extrait dans le morceau → vues', d.excerpts.positionVsViews],
              ].map(([label, value]) => {
                const v = value as LabData['excerpts']['energyVsViews'];
                return (
                  <li key={label as string}>
                    <span>{label as string}</span>
                    {v ? (
                      <>
                        <span className="num">ρ = {fmtNum(v.rho, 2)}</span>
                        <TierBadge confidence={v.confidence} />
                      </>
                    ) : (
                      <span className="muted">pas assez de Shorts liés</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="small muted">
              ρ va de −1 à 1 : positif = « plus il y en a, plus ça marche ». Une corrélation n’est
              pas une cause : un extrait énergique est aussi souvent le refrain.
            </p>
          </Card>
        </div>
      </Section>

      <Section
        id="styles"
        title="Comparaison des styles"
        what="Chaque groupe de Shorts comparé à tous les autres sur l’indice à J+7 (Mann-Whitney, intervalle bootstrap du rapport des médianes, correction de Holm dans chaque famille). Le trait vertical = 1, comme d’habitude."
      >
        <div className="ys-two">
          {d.styles.map((family) => (
            <Card key={family.family} title={family.title}>
              {family.groups.length === 0 ? (
                <p className="muted">Aucun Short de ce type pour l’instant.</p>
              ) : (
                <>
                  <BarList
                    reference={1}
                    rows={family.groups.map((g) => ({
                      key: g.key,
                      label: (
                        <>
                          {g.label} <span className="muted">({g.n})</span>
                        </>
                      ),
                      value: g.medianIndex ?? 0,
                      hint: `${g.confidence.reason}${g.medianPct !== null ? ` · ${fmtNum(g.medianPct, 0)} % regardé` : ''}`,
                      badge: <TierBadge confidence={g.confidence} />,
                    }))}
                    format={(n) => `×${fmtNum(n, 2)}`}
                  />
                </>
              )}
            </Card>
          ))}
        </div>
      </Section>

      <Section
        id="when"
        title="Jour et heure de publication"
        what="Indice médian à J+7 selon le moment de publication (fuseau des réglages). Chaque case montre l’indice et, en petit, le nombre de vidéos : une case avec 1 vidéo ne prouve rien."
      >
        {kindSwitch}
        <div className="ys-two">
          <Card title={`Carte de chaleur — ${kind === 'short' ? 'Shorts' : 'vidéos longues'}`}>
            <Heatmap
              rows={WEEKDAYS.map((w) => w.slice(0, 3))}
              columns={HOURS}
              cell={(row, column) => {
                const cell = heat.cells.find((c) => c.weekday === row && c.bucket === column)!;
                return { value: cell.medianIndex, n: cell.n };
              }}
            />
            <Legend
              items={[
                { label: 'Mieux que d’habitude', color: 'var(--series-1)', box: true },
                { label: 'Moins bien', color: 'var(--series-4)', box: true },
              ]}
            />
            <p className="small muted">
              Plus la teinte est forte, plus l’écart est grand ; case neutre = comme d’habitude.
            </p>
          </Card>
          <Card title="Par jour (tous horaires)">
            <ul className="ys-findings">
              {weekdays.groups.map((g) => (
                <li key={g.key}>
                  <span>
                    {g.label} <span className="muted small">({g.n})</span>
                  </span>
                  <IndexValue value={g.medianIndex} />
                  <TierBadge confidence={g.confidence} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section
        id="conversion"
        title="Conversion"
        what="Ce que les vues rapportent : abonnés nets pour 1 000 vues, j’aime pour 100 vues, partages pour 1 000 vues (médianes par vidéo, vidéos d’au moins 50 vues)."
      >
        <Card
          title={
            <>
              Shorts vs vidéos longues{' '}
              {d.conversion.shortsVsLong && (
                <TierBadge confidence={d.conversion.shortsVsLong.confidence} />
              )}
            </>
          }
        >
          <table className="ys-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">
                  <Metric k="subsPer1000" />
                </th>
                <th className="num">
                  <Metric k="likeRate" />
                </th>
                <th className="num">
                  <Metric k="shareRate" />
                </th>
                <th className="num">Vidéos</th>
              </tr>
            </thead>
            <tbody>
              {d.conversion.byKind.map((k) => (
                <tr key={k.kind}>
                  <td>{k.kind === 'short' ? 'Shorts' : 'Vidéos longues'}</td>
                  <td className="num">{fmtNum(k.subsPer1000, 1)}</td>
                  <td className="num">
                    {k.likeRate === null ? '—' : `${fmtNum(k.likeRate, 1)} %`}
                  </td>
                  <td className="num">
                    {k.shareRate === null ? '—' : `${fmtNum(k.shareRate, 1)} ‰`}
                  </td>
                  <td className="num">{k.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section
        id="life"
        title="Cycle de vie"
        what="Vitesse de démarrage (part des vues de J+7 déjà faites à J+1), demi-vie (jours pour faire la moitié des vues actuelles), et vidéos « evergreen » : à plus de 60 jours, leurs 28 derniers jours valent encore au moins 25 % des 28 premiers."
      >
        <Card title="Vidéos">
          <table className="ys-table">
            <thead>
              <tr>
                <th>Vidéo</th>
                <th className="num">Âge</th>
                <th className="num">Démarrage</th>
                <th className="num">
                  <Metric k="halfLife" />
                </th>
                <th>Durée de vie</th>
              </tr>
            </thead>
            <tbody>
              {[...d.videos]
                .filter((v) => v.age >= 14)
                .sort((a, b) => (b.evergreenRatio ?? -1) - (a.evergreenRatio ?? -1))
                .slice(0, 15)
                .map((v) => (
                  <tr key={v.id}>
                    <td>
                      <button
                        type="button"
                        className="ys-link"
                        onClick={() => props.openVideo(v.id)}
                      >
                        {v.title}
                      </button>
                      <div className="small muted">{kindLabel(v.kind)}</div>
                    </td>
                    <td className="num">{v.age} j</td>
                    <td className="num">
                      {v.startSpeed === null ? '—' : `${fmtNum(v.startSpeed * 100, 0)} %`}
                    </td>
                    <td className="num">{v.halfLife === null ? '—' : `${v.halfLife} j`}</td>
                    <td>
                      {v.evergreen ? (
                        <span className="badge badge--success">🌲 Evergreen</span>
                      ) : v.evergreenRatio !== null ? (
                        <span className="small muted">
                          {fmtNum(v.evergreenRatio * 100, 0)} % de son début
                        </span>
                      ) : (
                        <span className="small muted">trop jeune</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section
        id="anomalies"
        title="Anomalies"
        what="Jours inhabituels de la chaîne : écart robuste (médiane et MAD des 14 jours précédents, sur le logarithme des vues) au-delà de 3,5. Annotés avec les publications du jour et de la veille ; un pic sans publication a une autre cause (partage externe, suggestion)."
      >
        <Card title={`${d.anomalies.length} jour(s) inhabituel(s)`}>
          <ul className="ys-events">
            {[...d.anomalies]
              .reverse()
              .slice(0, 20)
              .map((a) => (
                <li key={a.day}>
                  <strong>{fmtDay(a.day)}</strong> — {a.kind === 'spike' ? '▲ pic' : '▼ creux'} :{' '}
                  {fmtInt(a.value)} vues au lieu de ~{fmtInt(a.expected)}
                  <div className="small muted">
                    {a.events.length
                      ? a.events.slice(0, 2).join(' · ')
                      : 'Aucune publication ce jour-là ni la veille.'}
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      </Section>

      <Section
        id="music"
        title="Rétention × musique"
        what="Perte d’audience pour 10 % de vidéo selon la section de la musique où l’on se trouve (sections estimées d’après l’énergie de la forme d’onde : intro, montée, drop, pause, outro). Médiane sur les vidéos liées à un morceau."
      >
        <Card
          title={
            <>
              Où les spectateurs décrochent{' '}
              {d.sectionTest && <TierBadge confidence={d.sectionTest.confidence} />}
            </>
          }
        >
          {d.sections.length === 0 ? (
            <p className="muted">
              Il faut des vidéos liées à un morceau avec une courbe de rétention.
            </p>
          ) : (
            <BarList
              rows={[...d.sections]
                .sort((a, b) => a.lossPer10 - b.lossPer10)
                .map((s) => ({
                  key: s.label,
                  label: `${s.label} (${s.n})`,
                  value: -s.lossPer10 * 100,
                  hint: `${fmtNum(-s.lossPer10 * 100, 1)} points d’audience perdus pour 10 % de vidéo`,
                }))}
              format={(n) => `−${fmtNum(n, 1)} pt`}
              color="var(--series-4)"
            />
          )}
          <p className="small muted">
            Barre longue = on y perd beaucoup d’audience. Le détail vidéo par vidéo (courbe
            superposée à la forme d’onde) est dans chaque fiche vidéo. Croisement avec la loudness
            et la dynamique : prévu si un module « Analyse du master » existe un jour (service
            facultatif).
          </p>
        </Card>
      </Section>
    </div>
  );
}
