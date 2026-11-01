// Onglet « Batch » : a calculation form in three steps (meals to cover,
// cooking slots, options), « Calculer » only on a click, the proposal (which
// changes nothing), « Valider ce plan », and the validated plans (time and
// length of a session, « Annuler ce plan », « le planning a changé »). The
// keeping times are Thomas's: the app does not check them.
import { Fragment, useMemo, useState } from 'react';
import { Button, Card, EmptyState, ErrorMessage, Icon, useApi, useModule } from '@hub/sdk/frontend';
import {
  coupleKey,
  entryState,
  forCalculation,
  initialSelection,
  selectAll,
  selectNone,
  selectRange,
  selectTagged,
  tickedParts,
  toggle,
} from '../shared/batch-form';
import { addDaysTo, gridDates } from '../shared/batch-grid';
import { cookKey, withAdditions } from '../shared/batch-suggest';
import type {
  BatchAdditionDto,
  BatchSuggestionDto,
  BatchUseDto,
  BatchCookDto,
  BatchEntryDto,
  BatchPlanDto,
  BatchProposalDto,
  BatchSessionDto,
  BatchSlotDto,
  BatchStateDto,
  MomentDto,
} from '../shared/types';

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

const weekday = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
const shortDate = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
const portionsText = (n: number) =>
  `${String(Math.round(n * 100) / 100).replace('.', ',')} portion${n > 1 ? 's' : ''}`;
/** Couples to cook on the day, grouped by what (a preparation, or a recipe) and reason. */
function uncoveredGroups(list: BatchProposalDto['uncovered']) {
  const groups = new Map<
    string,
    { name: string; prepId: string | null; reason: string; entryIds: string[] }
  >();
  for (const u of list) {
    const key = `${u.prepId ?? ''}|${u.name}|${u.reason}`;
    const g = groups.get(key) ?? { name: u.name, prepId: u.prepId, reason: u.reason, entryIds: [] };
    g.entryIds.push(u.entryId);
    groups.set(key, g);
  }
  return [...groups.values()];
}
const shortWeekday = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const slotKey = (s: BatchSlotDto) => `${s.date}|${s.momentId}`;

/** Read once, from the batch tab or the planning: the guide. */
function Guide() {
  return (
    <details className="cs-batch-guide">
      <summary>
        <Icon name="help" /> Comment ça marche ?
      </summary>
      <div className="cs-batch-guide__body small">
        <p>
          <strong>À quoi sert cet onglet.</strong> Il propose des sessions de cuisine pour préparer
          à l’avance des repas de ton planning (batch cooking). Il ne modifie rien : ni le planning,
          ni la liste de courses, ni les portions. Sans calcul, rien ne change.
        </p>
        <p>
          <strong>Trois étapes.</strong> 1. Coche les repas à couvrir (ceux dont la recette a le tag
          « batch » sont pré-cochés). 2. Coche les créneaux où tu peux cuisiner (une grille
          habituelle les pré-remplit, « Retenir comme habituels » la change). 3. Choisis les
          options, puis « Calculer ».
        </p>
        <p>
          <strong>Par préparation.</strong> Ce qui se prépare à l’avance, ce sont les{' '}
          <strong>préparations</strong> d’une recette (la sauce de la bolognaise, le riz cuit, les
          œufs durs), chacune avec sa propre conservation. Les lignes d’ingrédients directes d’une
          recette découpée (les pâtes) se font au moment du repas et n’apparaissent pas ici. Une
          recette sans préparation est préparée en bloc, avec la conservation de la recette. Une
          préparation utilisée par plusieurs recettes (le riz du chili et des boîtes) est cuite une
          seule fois par session, portions additionnées.
        </p>
        <p>
          <strong>Comment les sessions sont choisies.</strong> Chaque préparation d’un repas a une
          fenêtre de cuisson : on peut la cuisiner à son créneau ou avant, tant que sa durée de
          conservation n’est pas dépassée. L’outil cherche le moins de sessions qui couvrent le plus
          de préparations, puis cuisine chaque préparation une seule fois si possible, met le moins
          possible au congélateur et cuisine au plus près.
        </p>
        <svg
          className="cs-batch-guide__figure"
          viewBox="0 0 420 92"
          role="img"
          aria-label="Fenêtre de cuisson : un repas du jeudi se gardant 2 jours peut être cuisiné mardi, mercredi ou jeudi."
        >
          {['lun', 'mar', 'mer', 'jeu', 'ven'].map((d, i) => (
            <g key={d}>
              <text x={42 + i * 84} y={84} textAnchor="middle" className="cs-svg-text">
                {d}
              </text>
              <line x1={42 + i * 84} y1={56} x2={42 + i * 84} y2={66} className="cs-svg-axis" />
            </g>
          ))}
          <line x1={0} y1={61} x2={420} y2={61} className="cs-svg-axis" />
          <rect x={116} y={26} width={188} height={22} rx={6} className="cs-svg-window" />
          <text x={210} y={41} textAnchor="middle" className="cs-svg-text">
            fenêtre de cuisson
          </text>
          <text x={380} y={41} textAnchor="middle" className="cs-svg-text">
            (se garde 2 j)
          </text>
          <circle cx={294} cy={61} r={6} className="cs-svg-meal" />
          <text x={294} y={16} textAnchor="middle" className="cs-svg-text">
            repas
          </text>
        </svg>
        <p>
          <strong>Frigo ou congélateur.</strong> Sans congélation, un repas n’est couvert que dans
          sa durée au frigo. Avec la congélation et une préparation (ou recette) congelable, la
          fenêtre s’étend à sa durée au congélateur : les portions mangées au-delà de la durée au
          frigo partent au congélateur, et ne sont jamais mangées le jour de la cuisson. Une fois le
          plan validé, le planning affiche la veille « À décongeler : … ».
        </p>
        <p>
          <strong>Les durées de conservation sont celles que tu renseignes</strong> dans chaque
          fiche (préparation, ou recette non découpée) : l’outil ne les vérifie pas.
        </p>
        <p>
          <strong>Pourrait aussi servir.</strong> Une cuisson prévue peut servir à d’autres repas
          planifiés : il suffit d’en faire davantage. Sous chaque cuisson, l’outil propose les repas
          non cochés qui utilisent la même préparation (ou la même recette entière) et qu’elle peut
          couvrir avec les mêmes règles (frigo, et congélateur seulement si la congélation est
          activée). C’est un gain pur : jamais de session en plus, jamais de cuisson en plus, jamais
          un autre créneau. La correspondance se fait par préparation, jamais par ingrédient : du
          riz en ligne directe n’est pas du « Riz cuit ». « Ajouter » rattache le repas à cette
          cuisson (pour cette préparation seulement, l’étape 1 l’indique) ; « Retirer » le défait.
          Astuce : une recette qui utilise une préparation (par exemple « Riz cuit ») peut en
          profiter même si elle n’est pas faite pour le batch ; hors batch, ses préparations se font
          simplement au moment du repas.
        </p>
        <p className="muted">
          Limite : une période ne réutilise pas les portions congelées d’une période précédente.
        </p>
      </div>
    </details>
  );
}

/** « mar. soir (Chili) ». */
const forText = (u: BatchUseDto, moments: Map<string, MomentDto>) =>
  `${shortWeekday(u.date)} ${(moments.get(u.momentId)?.name ?? '').toLowerCase()}${u.mealName ? ` (${u.mealName})` : ''}`;

/**
 * One cooking of a session: what (a preparation, or a recipe cooked whole),
 * how many portions, what it is in ingredients, where it goes, the meals it
 * is for (« pour : … »), and (proposals only) « Pourrait aussi servir ». No
 * assembly, no times.
 */
function CookLines(props: {
  cook: BatchCookDto;
  moments: Map<string, MomentDto>;
  /** Proposals only: « Ajouter » a suggestion, « Retirer » an addition. */
  onAdd?: (suggestions: BatchSuggestionDto[]) => void;
  onRemove?: (entryId: string) => void;
}) {
  const { cook } = props;
  const sum = (list: { servings: number }[]) =>
    Math.round(list.reduce((n, u) => n + u.servings, 0) * 100) / 100;
  const frozen = sum(cook.frozen);
  const where =
    cook.fridge.length && cook.frozen.length
      ? `frigo, dont ${String(frozen).replace('.', ',')} au congélateur`
      : cook.frozen.length
        ? 'congélateur'
        : 'frigo';
  const uses = [
    ...cook.fridge.map((u) => ({ u, frozen: false })),
    ...cook.frozen.map((u) => ({ u, frozen: true })),
  ].sort(
    (a, b) =>
      a.u.date.localeCompare(b.u.date) ||
      [...props.moments.keys()].indexOf(a.u.momentId) -
        [...props.moments.keys()].indexOf(b.u.momentId),
  );
  const suggestions = cook.suggestions ?? [];
  return (
    <li className="cs-batch-cook">
      <strong>{cook.mealName}</strong> — {portionsText(cook.portions)}
      {cook.ingredients.length > 0 && (
        <span className="small">
          {' '}
          ({cook.ingredients.map((i) => `${i.name} ${i.amount}`).join(' · ')})
        </span>
      )}{' '}
      → {where}
      {uses.length > 0 && (
        <p className="small cs-batch-for">
          pour :{' '}
          {uses.map(({ u, frozen: f }, k) => (
            <Fragment key={`${u.entryId}${k}`}>
              {k > 0 && ' · '}
              {forText(u, props.moments)}
              {f && ' — congélateur, sortir la veille'}
              {u.added && props.onRemove && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="cs-link"
                    onClick={() => props.onRemove!(u.entryId)}
                  >
                    Retirer
                  </button>
                </>
              )}
            </Fragment>
          ))}
        </p>
      )}
      {props.onAdd && suggestions.length > 0 && (
        <details className="small cs-batch-suggest" open>
          <summary>Pourrait aussi servir</summary>
          <p className="muted">
            Sans session ni cuisson en plus : il suffit d’en faire davantage pendant cette cuisson.
          </p>
          <ul>
            {suggestions.map((x) => (
              <li key={x.entryId}>
                {forText(x, props.moments)}
                {x.frozen && ' — congélateur, sortir la veille'}{' '}
                <Button small variant="secondary" onClick={() => props.onAdd!([x])}>
                  Ajouter
                </Button>
              </li>
            ))}
          </ul>
          {suggestions.length > 1 && (
            <Button small variant="secondary" onClick={() => props.onAdd!(suggestions)}>
              Tout ajouter
            </Button>
          )}
        </details>
      )}
    </li>
  );
}

function SessionCard(props: {
  session: BatchSessionDto;
  moments: Map<string, MomentDto>;
  /** Validated plans: time and length editable. */
  onEdit?: (change: { startTime?: string; durationMin?: string }) => void;
  /** Proposals only: « Pourrait aussi servir ». */
  onAdd?: (cook: BatchCookDto, suggestions: BatchSuggestionDto[]) => void;
  onRemove?: (cook: BatchCookDto, entryId: string) => void;
}) {
  const s = props.session;
  const moment = props.moments.get(s.momentId)?.name.toLowerCase() ?? '';
  return (
    <div className="cs-batch-session">
      <h4>
        {capitalised(weekday(s.date))} {moment}{' '}
        <span className="small muted">({shortDate(s.date)})</span>
        {s.beforePeriod && <span className="badge badge--warning">avant la période</span>}
      </h4>
      {s.beforePeriod && (
        <p className="small">
          Session avant la période : ses ingrédients sont à acheter avant ce jour-là (les listes de
          courses ne sont pas modifiées).
        </p>
      )}
      {s.warnings.map((w) => (
        <p key={w} className="small cs-batch-warning">
          <Icon name="warning" /> {w}
        </p>
      ))}
      {props.onEdit && (
        <div className="cs-row small">
          <label>
            Heure{' '}
            <input
              className="input input--short"
              type="time"
              defaultValue={s.startTime ?? ''}
              aria-label="Heure de la session"
              onBlur={(e) =>
                e.target.value !== (s.startTime ?? '') &&
                props.onEdit!({ startTime: e.target.value })
              }
            />
          </label>
          <label>
            Durée{' '}
            <input
              className="input input--short num"
              type="number"
              min={1}
              max={1440}
              defaultValue={s.durationMin ?? ''}
              placeholder="min"
              aria-label="Durée de la session (minutes)"
              onBlur={(e) =>
                e.target.value !== String(s.durationMin ?? '') &&
                props.onEdit!({ durationMin: e.target.value })
              }
            />{' '}
            min
          </label>
        </div>
      )}
      <ul className="cs-batch-cooks">
        {s.cooks.map((c) => (
          <CookLines
            key={c.prepId ?? c.mealId}
            cook={c}
            moments={props.moments}
            onAdd={props.onAdd && ((list) => props.onAdd!(c, list))}
            onRemove={props.onRemove && ((entryId) => props.onRemove!(c, entryId))}
          />
        ))}
      </ul>
    </div>
  );
}

export function BatchTab(props: {
  from: string;
  to: string;
  run: Run;
  /** Opens the recipe's sheet (keeping to fill in). */
  onEditMeal: (mealId: string) => void;
  /** Opens a preparation's sheet (keeping to fill in). */
  onEditPrep: (prepId: string) => void;
}) {
  const module = useModule();
  const url = module.url(`/batch?from=${props.from}&to=${props.to}`);
  const { data, error, reload } = useApi<BatchStateDto>(url);
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!data) return <p className="muted">Chargement…</p>;
  // A new period (or new data after a validation): the form starts again from it.
  return (
    <BatchForm
      key={`${data.from}|${data.to}|${data.plans.map((p) => p.id).join()}|${data.entries.length}`}
      state={data}
      run={props.run}
      reload={reload}
      onEditMeal={props.onEditMeal}
      onEditPrep={props.onEditPrep}
    />
  );
}

function BatchForm(props: {
  state: BatchStateDto;
  run: Run;
  reload: () => void;
  onEditMeal: (mealId: string) => void;
  onEditPrep: (prepId: string) => void;
}) {
  const module = useModule();
  const s = props.state;
  const moments = useMemo(() => new Map(s.moments.map((m) => [m.id, m])), [s.moments]);
  const [selection, setSelection] = useState(() => initialSelection(s.entries));
  const [slots, setSlots] = useState(() => new Set(s.grid.slots.map(slotKey)));
  const [freezer, setFreezer] = useState(false);
  const [daysBefore, setDaysBefore] = useState(s.daysBefore);
  const [rangeFrom, setRangeFrom] = useState(s.from);
  const [rangeTo, setRangeTo] = useState(s.to);
  // The proposal as computed, the couples it was computed for, and « Ajouter » taken since.
  const [computed, setComputed] = useState<{
    proposal: BatchProposalDto;
    couples: { entryId: string; prepId: string | null }[];
  } | null>(null);
  const [additions, setAdditions] = useState<BatchAdditionDto[]>([]);
  const momentOrder = s.moments.map((m) => m.id);
  const proposal = computed ? withAdditions(computed.proposal, additions, momentOrder) : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);

  const dates = gridDates(s.from, s.to, daysBefore);
  const shownSlots = [...slots]
    .map((k) => {
      const [date, momentId] = k.split('|') as [string, string];
      return { date, momentId };
    })
    .filter((x) => dates.includes(x.date) && moments.has(x.momentId));
  // Meals before the period: shown (and computed) only within the N days allowed.
  const minDate = addDaysTo(s.from, -daysBefore);
  const shownEntries = s.entries.filter((e) => e.date >= minDate);
  const { entryIds, couples, missing } = forCalculation(s.entries, selection, minDate);
  const byPrep = s.entries.some(
    (e) => entryIds.includes(e.entryId) && e.parts.some((p) => p.prepId),
  );
  const entryById = new Map(s.entries.map((e) => [e.entryId, e]));
  const periodDates = gridDates(s.from, s.to, 0);
  const changed = () => {
    setComputed(null);
    setAdditions([]);
    setError(null);
  };
  /** « Ajouter »: the meal joins this cooking (shown at once, no calculation); included in step 1 for this part. */
  const add = (session: BatchSessionDto, cook: BatchCookDto, list: BatchSuggestionDto[]) => {
    setAdditions([
      ...additions,
      ...list.map((x) => ({
        date: session.date,
        momentId: session.momentId,
        cook: cookKey(cook),
        entryId: x.entryId,
      })),
    ]);
    const next = new Set(selection);
    for (const x of list) next.add(coupleKey(x.entryId, cook.prepId));
    setSelection(next);
  };
  /** « Retirer »: exactly the state before that « Ajouter ». */
  const remove = (cook: BatchCookDto, entryId: string) => {
    setAdditions(additions.filter((a) => !(a.cook === cookKey(cook) && a.entryId === entryId)));
    const next = new Set(selection);
    next.delete(coupleKey(entryId, cook.prepId));
    setSelection(next);
  };

  const saveGrid = (next: Set<string>) => {
    setSlots(next);
    setModelSaved(false);
    changed();
    const list = [...next].map((k) => {
      const [date, momentId] = k.split('|') as [string, string];
      return { date, momentId };
    });
    // Saved for THIS period only; the model does not change.
    void props.run(() => module.api.put('/batch/grid', { from: s.from, to: s.to, slots: list }));
  };
  const body = (list = couples) => ({
    from: s.from,
    to: s.to,
    couples: list,
    slots: shownSlots,
    freezer,
    daysBefore,
  });
  const calculate = async () => {
    setBusy(true);
    setError(null);
    try {
      // The couples added before count as ticked; new suggestions come with the new proposal.
      const p = await module.api.post<BatchProposalDto>('/batch/compute', body());
      setComputed({ proposal: p, couples });
      setAdditions([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const validate = () =>
    void props
      .run(() =>
        module.api.post('/batch/plans', { ...body(computed?.couples ?? couples), additions }),
      )
      .then((ok) => {
        if (ok) props.reload();
      });

  const entryLabel = (e: BatchEntryDto) =>
    `${capitalised(shortDate(e.date))} · ${moments.get(e.momentId)?.name ?? ''}`;

  return (
    <div className="cs-batch">
      <Guide />
      {s.plans.length > 0 && (
        <Card title="Plans validés">
          {s.plans.map((plan) => (
            <ValidatedPlan
              key={plan.id}
              plan={plan}
              moments={moments}
              run={props.run}
              reload={props.reload}
            />
          ))}
        </Card>
      )}

      <Card title="1. Repas à couvrir">
        {s.entries.length === 0 ? (
          <EmptyState title="Aucun repas planifié sur cette période.">
            Planifie des repas dans l’onglet « Planning des repas ».
          </EmptyState>
        ) : (
          <>
            <div className="cs-row small">
              <Button
                small
                variant="secondary"
                onClick={() => (changed(), setSelection(selectAll(s.entries)))}
              >
                Tout
              </Button>
              <Button
                small
                variant="secondary"
                onClick={() => (changed(), setSelection(selectNone()))}
              >
                Rien
              </Button>
              <Button
                small
                variant="secondary"
                onClick={() => (changed(), setSelection(selectTagged(s.entries)))}
              >
                Seulement tag batch
              </Button>
              <span>
                Du{' '}
                <select
                  className="input"
                  value={rangeFrom}
                  aria-label="Du jour"
                  onChange={(e) => setRangeFrom(e.target.value)}
                >
                  {periodDates.map((d) => (
                    <option key={d} value={d}>
                      {shortDate(d)}
                    </option>
                  ))}
                </select>{' '}
                au{' '}
                <select
                  className="input"
                  value={rangeTo}
                  aria-label="Au jour"
                  onChange={(e) => setRangeTo(e.target.value)}
                >
                  {periodDates.map((d) => (
                    <option key={d} value={d}>
                      {shortDate(d)}
                    </option>
                  ))}
                </select>{' '}
                <Button
                  small
                  variant="secondary"
                  onClick={() => (
                    changed(),
                    setSelection(selectRange(s.entries, rangeFrom, rangeTo))
                  )}
                >
                  Cocher ces jours
                </Button>
              </span>
            </div>
            <table className="cs-batch-entries">
              <tbody>
                {shownEntries.map((e, k) => {
                  const covered = e.coveredBy !== null;
                  const state = covered ? 'none' : entryState(selection, e);
                  const ticked = state !== 'none';
                  const partlyCovered = e.parts.filter((p) => p.coveredBy);
                  return (
                    <Fragment key={e.entryId}>
                      {e.beforePeriod && k === 0 && (
                        <tr>
                          <th colSpan={5} className="small muted cs-batch-entries__head">
                            Avant la période (sessions jusqu’à {daysBefore} jour
                            {daysBefore > 1 ? 's' : ''} avant)
                          </th>
                        </tr>
                      )}
                      {!e.beforePeriod && k > 0 && shownEntries[k - 1]!.beforePeriod && (
                        <tr>
                          <th colSpan={5} className="small muted cs-batch-entries__head">
                            La période
                          </th>
                        </tr>
                      )}
                      <tr className={covered ? 'cs-batch-entry--covered' : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={state === 'all'}
                            ref={(el) => {
                              if (el) el.indeterminate = state === 'partial';
                            }}
                            disabled={covered}
                            aria-label={`Inclure ${e.mealName}, ${entryLabel(e)}`}
                            onChange={() => (changed(), setSelection(toggle(selection, e)))}
                          />
                        </td>
                        <td className="small">{entryLabel(e)}</td>
                        <td>
                          {e.mealName}
                          {e.batchTag && <span className="small muted"> #batch</span>}
                          {state === 'partial' && (
                            <span className="small cs-batch-partial">
                              {' '}
                              {tickedParts(selection, e)
                                .map((p) => p.name)
                                .join(', ')}{' '}
                              seulement
                            </span>
                          )}
                        </td>
                        <td className="small num">{portionsText(e.servings)}</td>
                        <td className="small">
                          {covered ? (
                            <span className="muted">
                              déjà couvert (annule le plan pour le changer)
                            </span>
                          ) : partlyCovered.length > 0 && !ticked ? (
                            <span className="muted">
                              {partlyCovered.map((p) => p.name).join(', ')} déjà couvert
                              {partlyCovered.length > 1 ? 's' : ''}
                            </span>
                          ) : ticked ? (
                            [
                              partlyCovered.length > 0 && (
                                <span key="covered" className="muted">
                                  {partlyCovered.map((p) => p.name).join(', ')} déjà couvert
                                  {partlyCovered.length > 1 ? 's' : ''}{' '}
                                </span>
                              ),
                            ].concat(
                              tickedParts(selection, e)
                                .filter((p) => p.fridgeDays === null)
                                .map((p) => (
                                  <span key={p.prepId ?? p.mealId} className="cs-batch-warning">
                                    <Icon name="warning" />{' '}
                                    {p.prepId
                                      ? `${p.name} : durée de conservation manquante`
                                      : 'durée de conservation manquante'}{' '}
                                    —{' '}
                                    <button
                                      type="button"
                                      className="cs-link"
                                      onClick={() =>
                                        p.prepId
                                          ? props.onEditPrep(p.prepId)
                                          : props.onEditMeal(e.mealId)
                                      }
                                    >
                                      compléter la fiche
                                    </button>
                                  </span>
                                )),
                            )
                          ) : null}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {missing.length > 0 && (
              <p className="small cs-batch-warning">
                {missing.length} {missing.some((m) => m.part.prepId) ? 'élément' : 'repas'} coché
                {missing.length > 1 ? 's' : ''} sans durée de conservation : exclu
                {missing.length > 1 ? 's' : ''} du calcul tant que la fiche n’est pas complétée.
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="2. Créneaux de cuisine">
        {shownSlots.length === 0 && (
          <p className="small cs-batch-warning">Coche les créneaux où tu peux cuisiner.</p>
        )}
        <div className="cs-plan-wrap">
          <table className="cs-batch-grid">
            <thead>
              <tr>
                <th />
                {s.moments.map((m) => (
                  <th key={m.id} className="small">
                    {m.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d} className={d < s.from ? 'cs-batch-grid__before' : undefined}>
                  <th scope="row" className="small">
                    {capitalised(shortDate(d))}
                    {d < s.from && <span className="muted"> · avant la période</span>}
                  </th>
                  {s.moments.map((m) => {
                    const key = slotKey({ date: d, momentId: m.id });
                    return (
                      <td key={m.id}>
                        <input
                          type="checkbox"
                          checked={slots.has(key)}
                          aria-label={`Cuisiner ${shortDate(d)} · ${m.name}`}
                          onChange={() => {
                            const next = new Set(slots);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            saveGrid(next);
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Cette grille est enregistrée pour cette période seulement.{' '}
          <Button
            small
            variant="secondary"
            onClick={() =>
              void props
                .run(() =>
                  module.api.post('/batch/grid/model', {
                    from: s.from,
                    to: s.to,
                    slots: shownSlots,
                  }),
                )
                .then((ok) => ok && setModelSaved(true))
            }
          >
            Retenir comme habituels
          </Button>{' '}
          {modelSaved && (
            <span>Créneaux habituels retenus : ils pré-rempliront les prochaines périodes.</span>
          )}
        </p>
      </Card>

      <Card title="3. Options">
        <div className="cs-row small">
          <span role="radiogroup" aria-label="Congélation">
            Congélation :{' '}
            <label>
              <input
                type="radio"
                checked={!freezer}
                onChange={() => (changed(), setFreezer(false))}
              />{' '}
              non
            </label>{' '}
            <label>
              <input
                type="radio"
                checked={freezer}
                onChange={() => (changed(), setFreezer(true))}
              />{' '}
              oui
            </label>
          </span>
          <label>
            Sessions jusqu’à{' '}
            <input
              className="input input--short num"
              type="number"
              min={0}
              max={7}
              value={daysBefore}
              aria-label="Jours avant la période"
              onChange={(e) => {
                changed();
                setDaysBefore(Math.max(0, Math.min(7, Math.round(Number(e.target.value) || 0))));
              }}
            />{' '}
            jour(s) avant la période
          </label>
        </div>
        <div className="cs-row">
          <Button
            onClick={() => void calculate()}
            disabled={busy || entryIds.length === 0 || shownSlots.length === 0}
          >
            Calculer
          </Button>
          {entryIds.length === 0 && <span className="small muted">Coche au moins un repas.</span>}
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </Card>

      {proposal && (
        <Card title="Proposition">
          {proposal.tooComplex ? (
            <p className="cs-batch-warning">
              <Icon name="warning" /> Trop de créneaux cochés pour un calcul exact : décoche des
              créneaux (ou raccourcis la période) et recalcule. Aucun plan approximatif n’est
              proposé.
            </p>
          ) : (
            <>
              <p>
                <strong>
                  {proposal.sessions.length} session{proposal.sessions.length > 1 ? 's' : ''} couvre
                  {proposal.sessions.length > 1 ? 'nt' : ''} {proposal.covered}{' '}
                  {byPrep ? 'préparations de repas' : 'repas'} sur {proposal.total}
                </strong>
                {proposal.total - proposal.covered > 0 &&
                  ` ; ${proposal.total - proposal.covered} à cuisiner le jour même`}
                {missing.length > 0 &&
                  ` ; ${missing.length} exclu${missing.length > 1 ? 's' : ''} (durée de conservation manquante)`}
                .
              </p>
              {proposal.sessions.map((session) => (
                <SessionCard
                  key={slotKey(session)}
                  session={session}
                  moments={moments}
                  onAdd={(cook, list) => add(session, cook, list)}
                  onRemove={remove}
                />
              ))}
              {proposal.uncovered.length > 0 && (
                <>
                  <h4>À cuisiner le jour même</h4>
                  <ul className="small">
                    {uncoveredGroups(proposal.uncovered).map((g) => (
                      <li key={`${g.name}|${g.reason}`}>
                        <strong>{g.name}</strong> (
                        {g.entryIds
                          .map((id) => {
                            const e = entryById.get(id);
                            return e
                              ? g.prepId
                                ? `${entryLabel(e)}, ${e.mealName}`
                                : entryLabel(e)
                              : id;
                          })
                          .join(' ; ')}
                        ) : {g.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="cs-row">
                <Button onClick={validate} disabled={!proposal.sessions.length}>
                  Valider ce plan
                </Button>
                <span className="small muted">
                  Rien n’est modifié : ni le planning, ni la liste de courses, ni les portions.
                </span>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function ValidatedPlan(props: {
  plan: BatchPlanDto;
  moments: Map<string, MomentDto>;
  run: Run;
  reload: () => void;
}) {
  const module = useModule();
  const { plan } = props;
  const covered = plan.sessions.reduce(
    (n, s) => n + s.cooks.reduce((m, c) => m + c.fridge.length + c.frozen.length, 0),
    0,
  );
  return (
    <div className="cs-batch-plan">
      <div className="cs-row">
        <strong>
          {plan.sessions.length} session{plan.sessions.length > 1 ? 's' : ''}, {covered} repas
        </strong>
        <span className="small muted">
          validé le {new Date(plan.createdAt).toLocaleDateString('fr-FR')}
          {plan.freezer ? ' · avec congélation' : ' · sans congélation'}
          {plan.daysBefore ? ` · jusqu’à ${plan.daysBefore} j avant` : ''}
        </span>
        <Button
          small
          variant="danger"
          onClick={() =>
            window.confirm(
              'Annuler ce plan validé ? Ses repas redeviennent disponibles pour un autre calcul (le planning et les listes ne changent pas).',
            ) &&
            void props
              .run(() => module.api.delete(`/batch/plans/${plan.id}`))
              .then((ok) => ok && props.reload())
          }
        >
          Annuler ce plan
        </Button>
      </div>
      {plan.changes.length > 0 && (
        <p className="cs-batch-banner" role="status">
          <Icon name="warning" /> Le planning a changé depuis la validation — recalculer (
          {plan.changes.join(' ; ')}). Rien n’a été recalculé : annule ce plan puis recalcule.
        </p>
      )}
      {plan.sessions.map((session) => (
        <Fragment key={session.id}>
          <SessionCard
            session={session}
            moments={props.moments}
            onEdit={(change) =>
              void props.run(() => module.api.patch(`/batch/sessions/${session.id}`, change))
            }
          />
        </Fragment>
      ))}
    </div>
  );
}
