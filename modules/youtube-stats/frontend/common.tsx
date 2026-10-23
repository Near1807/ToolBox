// Small pieces shared by the pages of the module: confidence badges, metric
// labels with their explanation on hover, the demo banner, filters, KPI tiles.
import type { ReactNode } from 'react';
import { METRICS, TIER_HELP, TIER_LABELS, type Confidence, type Tier } from '../shared';
import { fmtNum } from './charts';

export type { Confidence };

const TIER_ICONS: Record<Tier, string> = { intuition: '🎲', piste: '🔎', solide: '🧱' };
const TIER_CLASSES: Record<Tier, string> = {
  intuition: 'badge',
  piste: 'badge badge--accent',
  solide: 'badge badge--success',
};

/** Confidence tier, with the reason and the test on hover. */
export function TierBadge(props: { confidence: Confidence }) {
  const c = props.confidence;
  const details = [
    c.reason,
    `n = ${c.n.join(' vs ')}`,
    c.p !== null ? `p = ${c.p < 0.001 ? '< 0,001' : fmtNum(c.p, 3)}` : null,
    c.ci ? `IC 95 % [${fmtNum(c.ci[0], 2)} ; ${fmtNum(c.ci[1], 2)}]` : null,
    TIER_HELP[c.tier],
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className={`${TIER_CLASSES[c.tier]} ys-tier`} title={details}>
      <span aria-hidden="true">{TIER_ICONS[c.tier]}</span> {TIER_LABELS[c.tier]}
    </span>
  );
}

/** A metric's name, explained on hover (« ce que ça mesure »). */
export function Metric(props: { k: string; children?: ReactNode }) {
  const info = METRICS[props.k];
  return (
    <span className="ys-metric" title={info?.help}>
      {props.children ?? info?.label ?? props.k}
    </span>
  );
}

export function DemoBanner() {
  return (
    <div className="ys-demo" role="note">
      <strong>DONNÉES DE DÉMO</strong> — chaîne simulée pour voir l’outil rempli. Désactive le mode
      démo dans les réglages du module pour revenir à tes vraies statistiques.
    </div>
  );
}

export function Kpi(props: {
  label: ReactNode;
  value: ReactNode;
  delta?: { value: number | null; previous: number | null } | null;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  const delta = props.delta;
  let deltaText: ReactNode = null;
  if (delta && delta.previous !== null && delta.value !== null && delta.previous > 0) {
    const change = (delta.value - delta.previous) / delta.previous;
    deltaText = (
      <span className={change >= 0 ? 'ys-delta ys-delta--up' : 'ys-delta ys-delta--down'}>
        {change >= 0 ? '▲' : '▼'} {fmtNum(Math.abs(change) * 100, 0)} %
        <span className="muted"> vs période précédente</span>
      </span>
    );
  }
  return (
    <div className="ys-kpi">
      <div className="ys-kpi__label small muted">{props.label}</div>
      <div className="ys-kpi__value num">{props.value}</div>
      {deltaText}
      {props.hint && <div className="small muted">{props.hint}</div>}
      {props.children}
    </div>
  );
}

export interface FilterValues {
  period: string;
  kind: string;
  track: string;
}

export function Filters(props: {
  value: FilterValues;
  onChange: (value: FilterValues) => void;
  tracks?: { id: number; title: string }[];
  show?: ('period' | 'kind' | 'track')[];
}) {
  const show = props.show ?? ['period', 'kind'];
  const set = (patch: Partial<FilterValues>) => props.onChange({ ...props.value, ...patch });
  return (
    <div className="ys-filters">
      {show.includes('period') && (
        <select
          className="input input--short"
          value={props.value.period}
          onChange={(e) => set({ period: e.target.value })}
          aria-label="Période"
        >
          <option value="7">7 derniers jours</option>
          <option value="28">28 derniers jours</option>
          <option value="90">90 derniers jours</option>
          <option value="365">12 derniers mois</option>
          <option value="all">Depuis le début</option>
        </select>
      )}
      {show.includes('kind') && (
        <select
          className="input input--short"
          value={props.value.kind}
          onChange={(e) => set({ kind: e.target.value })}
          aria-label="Type"
        >
          <option value="all">Shorts et vidéos longues</option>
          <option value="short">Shorts seulement</option>
          <option value="video">Vidéos longues seulement</option>
        </select>
      )}
      {show.includes('track') && props.tracks && (
        <select
          className="input input--short"
          value={props.value.track}
          onChange={(e) => set({ track: e.target.value })}
          aria-label="Morceau"
        >
          <option value="">Tous les morceaux</option>
          {props.tracks.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export const filterQuery = (f: FilterValues) => {
  const params = new URLSearchParams({ period: f.period, kind: f.kind });
  if (f.track) params.set('track', f.track);
  return params.toString();
};

/** « ×1,8 mieux que d'habitude » with a tone. */
export function IndexValue(props: { value: number | null | undefined }) {
  const v = props.value;
  if (v === null || v === undefined) return <span className="muted">—</span>;
  const tone = v >= 1.15 ? 'ys-up' : v <= 0.85 ? 'ys-down' : '';
  return (
    <span
      className={`num ${tone}`}
      title="Vues divisées par ta médiane au même âge (même type de vidéo)"
    >
      ×{fmtNum(v, v >= 10 ? 0 : 2)}
    </span>
  );
}

export const kindLabel = (kind: string) => (kind === 'short' ? 'Short' : 'Vidéo longue');
