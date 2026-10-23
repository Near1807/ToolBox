// Théories: hypotheses in plain words with the data behind them, the sample
// size and the confidence tier; the journal that follows them over time; small
// experiments to settle them.
import { Card, ErrorMessage, useApi, useModule } from '@hub/sdk/frontend';
import { TIER_HELP, TIER_LABELS, type Tier } from '../shared';
import { fmtDay } from './charts';
import { TierBadge } from './common';
import type { TheoriesData } from './types';

const STATUS: Record<string, { label: string; className: string; icon: string }> = {
  confirmed: { label: 'Confirmée', className: 'badge badge--success', icon: '✓' },
  refuted: { label: 'Infirmée', className: 'badge badge--danger', icon: '✗' },
  pending: { label: 'En attente', className: 'badge', icon: '…' },
};

const TIER_DOT: Record<Tier, string> = {
  intuition: 'ys-dot-tier',
  piste: 'ys-dot-tier ys-dot-tier--piste',
  solide: 'ys-dot-tier ys-dot-tier--solide',
};

export function Theories() {
  const module = useModule();
  const data = useApi<TheoriesData>(module.url('/theories'));
  if (data.error) return <ErrorMessage>{data.error}</ErrorMessage>;
  const d = data.data;
  if (!d)
    return (
      <p className="muted">
        Calcul des théories (la première fois, le journal est reconstitué sur l’historique)…
      </p>
    );
  const groups: Tier[] = ['solide', 'piste', 'intuition'];
  return (
    <>
      <Card title="Comment lire les théories">
        <ul className="ys-legend-list">
          {groups.map((tier) => (
            <li key={tier}>
              <TierBadge confidence={{ tier, reason: TIER_HELP[tier], n: [], p: null, ci: null }} />{' '}
              {TIER_HELP[tier]}
            </li>
          ))}
        </ul>
        <p className="small muted">
          Méthodes adaptées aux petits échantillons : tests de Mann-Whitney et de Spearman (rangs,
          sans hypothèse de loi normale), intervalles par bootstrap, p-values par permutations,
          correction de Holm quand plusieurs groupes sont testés ensemble. Une corrélation ne prouve
          jamais une cause : les expériences proposées servent à trancher.
        </p>
      </Card>

      {groups.map((tier) => {
        const list = d.theories.filter((t) => t.confidence.tier === tier);
        if (list.length === 0) return null;
        return (
          <section key={tier} className="ys-lab">
            <h2>
              {TIER_LABELS[tier]}
              {tier === 'intuition' ? ' — pour le fun 🎲' : ''}{' '}
              <span className="muted small">({list.length})</span>
            </h2>
            <div className="ys-theories">
              {list.map((t) => (
                <article key={t.key} className={`ys-theory ys-theory--${tier}`}>
                  <header>
                    <TierBadge confidence={t.confidence} />
                    <span className="num ys-theory__effect">{t.effect}</span>
                  </header>
                  <h3>
                    {tier === 'intuition' ? 'Et si… ' : ''}
                    {t.text}
                    {tier === 'intuition' ? ' ?' : '.'}
                  </h3>
                  <p className="small">{t.detail}</p>
                  <p className="small muted">
                    {t.confidence.reason} Échantillon : {t.confidence.n.join(' vs ')}.
                  </p>
                  {t.caveat && <p className="small ys-caveat">⚠ {t.caveat}</p>}
                  {t.experiment && (
                    <p className="small ys-experiment">
                      <strong>Expérience :</strong> {t.experiment}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <Card title={`Journal des théories (${d.journal.length})`}>
        <p className="small muted">
          Chaque synchronisation réévalue les théories. Confirmée : « Solide » deux fois de suite
          dans le même sens. Infirmée : elle était une piste, puis l’effet s’est inversé ou a
          disparu. Les points marqués « a posteriori » ont été recalculés sur l’historique tel qu’il
          était à ces dates.
        </p>
        <table className="ys-table">
          <thead>
            <tr>
              <th>Théorie</th>
              <th>Statut</th>
              <th>Évolution</th>
              <th>Depuis</th>
            </tr>
          </thead>
          <tbody>
            {d.journal.map((entry) => {
              const status = STATUS[entry.status]!;
              return (
                <tr key={entry.key}>
                  <td>
                    {entry.text}
                    <div className="small muted">{entry.statusReason}</div>
                  </td>
                  <td>
                    <span className={status.className}>
                      {status.icon} {status.label}
                    </span>
                  </td>
                  <td>
                    <span className="ys-history" aria-label="Paliers successifs">
                      {entry.history.map((h, i) => (
                        <span
                          key={i}
                          className={`${h.direction === 0 ? 'ys-dot-tier ys-dot-tier--gone' : TIER_DOT[h.tier]}${h.retro ? ' ys-dot-tier--retro' : ''}`}
                          title={`${fmtDay(h.at.slice(0, 10))} : ${h.direction === 0 ? 'non produite' : `${TIER_LABELS[h.tier]}, ${h.effect}${h.direction < 0 ? ' (sens inverse)' : ''}`}${h.retro ? ' — a posteriori' : ''}`}
                        >
                          {h.direction < 0 ? '↓' : ''}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="small muted nowrap">{fmtDay(entry.firstSeen.slice(0, 10))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
