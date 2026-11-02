// Onglet « Batch » (v0.29, en deux temps). Temps 1, ÉLÉMENTS DE BASE: a
// session dedicated to preparing ahead the recurring elements that keep (rice,
// hard-boiled eggs…): elements ticked, cooking slots, options, the exact
// calculation on a click. Temps 2, DOUBLES DOSES: when a meal is cooked at
// meal time, more of it for the next meals of the same element. The proposal
// changes nothing; « Valider ce plan » keeps both. The keeping times are
// Thomas's: the app does not check them.
import { Fragment, useMemo, useState } from 'react';
import { Button, Card, EmptyState, ErrorMessage, Icon, useApi, useModule } from '@hub/sdk/frontend';
import {
  elementsOf,
  elementState,
  forCalculation,
  initialSelection,
  selectAll,
  selectNone,
  toggleElement,
  toggleMeal,
  coupleKey,
  type Element,
} from '../shared/batch-form';
import { addDaysTo, gridDates } from '../shared/batch-grid';
import { amountsOf, cookLines, forLine, type IngredientFacts } from '../shared/batch-cook';
import type {
  BatchCookDto,
  BatchDoubleDto,
  BatchPlanDto,
  BatchProposalDto,
  BatchSessionDto,
  BatchSlotDto,
  BatchStateDto,
  BatchUseDto,
  MomentDto,
} from '../shared/types';

type Run = (action: () => Promise<unknown>) => Promise<boolean>;
type Moments = Map<string, MomentDto>;

const fmt = (date: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('fr-FR', { ...o, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const weekday = (date: string) => fmt(date, { weekday: 'long' });
const shortDay = (date: string) => fmt(date, { weekday: 'short' });
const shortDate = (date: string) => fmt(date, { weekday: 'short', day: 'numeric', month: 'short' });
const portionsText = (n: number) =>
  `${String(Math.round(n * 100) / 100).replace('.', ',')} portion${n > 1 ? 's' : ''}`;
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const slotKey = (s: BatchSlotDto) => `${s.date}|${s.momentId}`;
const momentName = (moments: Moments, id: string) => (moments.get(id)?.name ?? '').toLowerCase();
const when = (u: { date: string; momentId: string }, moments: Moments) =>
  `${shortDay(u.date)} ${momentName(moments, u.momentId)}`;

const byRecipe = (uses: readonly BatchUseDto[], moments: Moments) =>
  forLine(uses, new Map([...moments].map(([id, m]) => [id, m.name])));

/** Read once: the two times, in a few words. */
function Guide() {
  return (
    <details className="cs-batch-guide">
      <summary>
        <Icon name="help" /> Comment ça marche ?
      </summary>
      <div className="cs-batch-guide__body small">
        <p>
          <strong>Temps 1 — éléments de base.</strong> Une session dédiée, sans lien avec un repas,
          pour préparer d’avance les éléments qui reviennent et se conservent (riz cuit, œufs
          durs…). Coche les éléments, les créneaux où tu peux cuisiner, les options, puis « Calculer
          » : le moins de sessions, puis le moins de cuissons, le moins de congélateur, au plus près
          des repas. Un élément = une préparation, ou une recette non découpée.
        </p>
        <p>
          <strong>Temps 2 — doubles doses.</strong> Quand tu cuisines ton plat au moment du repas,
          tu en fais plus pour un repas suivant (gratin mardi soir × 2 pour mercredi soir). Une
          cuisson s’ouvre au premier repas pris à un moment où tu cuisines, et couvre les repas
          suivants du même élément tant qu’ils se conservent (frigo ; congélateur si l’option est
          active et l’élément congelable, jamais mangé congelé le jour même, décongélation la
          veille). Une cuisson pour un seul repas, c’est la cuisine normale : elle n’est pas
          affichée.
        </p>
        <p>
          <strong>Les deux s’emboîtent :</strong> le riz du curry vient de la session, la sauce est
          faite en double dose (« riz : déjà préparé »). Rien n’est modifié (planning, listes,
          portions) ; « Valider ce plan » garde les deux temps. Le tag « batch » des recettes n’a
          plus d’effet.
        </p>
        <p>
          <strong>Les durées de conservation sont celles que tu renseignes</strong> dans chaque
          fiche : l’outil ne les vérifie pas. Limite : une période ne réutilise pas les portions
          congelées d’une période précédente.
        </p>
      </div>
    </details>
  );
}

/** One cooking: what, portions, ingredients (in the recipe's order), where it goes, for whom. */
function CookLines(props: { cook: BatchCookDto; moments: Moments }) {
  const { cook } = props;
  const frozen = Math.round(cook.frozen.reduce((n, u) => n + u.servings, 0) * 100) / 100;
  const where =
    cook.fridge.length && cook.frozen.length
      ? `frigo, dont ${String(frozen).replace('.', ',')} au congélateur`
      : cook.frozen.length
        ? 'congélateur'
        : 'frigo';
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
      <p className="small cs-batch-for">
        pour : {byRecipe(cook.fridge, props.moments)}
        {cook.frozen.length > 0 &&
          `${cook.fridge.length ? ' · ' : ''}congélateur : ${byRecipe(cook.frozen, props.moments)}, sortir la veille`}
      </p>
    </li>
  );
}

function SessionCard(props: {
  session: BatchSessionDto;
  moments: Moments;
  facts: IngredientFacts;
  /** Validated plans: time and length editable. */
  onEdit?: (change: { startTime?: string; durationMin?: string }) => void;
}) {
  const s = props.session;
  // « Ce que tu utilises » : the cookings of the session added up.
  const used = amountsOf(
    s.cooks.flatMap((c) => (c.basis ? cookLines(c.basis, c.portions) : [])),
    props.facts,
  );
  return (
    <div className="cs-batch-session">
      <h4>
        {capitalised(weekday(s.date))} {momentName(props.moments, s.momentId)}{' '}
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
          <CookLines key={c.prepId ?? c.mealId} cook={c} moments={props.moments} />
        ))}
      </ul>
      {used.length > 0 && (
        <details className="small">
          <summary>Ce que tu utilises</summary>
          {used.map((i) => `${i.name} ${i.amount}`).join(' · ')}
        </details>
      )}
    </div>
  );
}

/** Temps 2: « mar. soir — Gratin × 2 → aussi mer. soir », with « riz : déjà préparé ». */
function Doubles(props: {
  doubles: readonly BatchDoubleDto[];
  moments: Moments;
  /** Proposals only: the « inclure » tick of each double dose. */
  excluded?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <ul className="cs-batch-doubles">
      {props.doubles.map((d) => (
        <li key={d.key}>
          {props.onToggle && (
            <input
              type="checkbox"
              checked={!props.excluded?.has(d.key)}
              aria-label={`Inclure la double dose ${d.name}, ${when(d.opener, props.moments)}`}
              onChange={() => props.onToggle!(d.key)}
            />
          )}{' '}
          <strong>{when(d.opener, props.moments)}</strong> — {d.name} × {d.also.length + 1} → aussi{' '}
          {d.also
            .map(
              (a) =>
                `${when(a, props.moments)}${a.frozen ? ' (congélateur, sortir la veille)' : ''}`,
            )
            .join(', ')}
          <span className="small muted">
            {' '}
            ({portionsText(d.portions)} :{' '}
            {d.ingredients.map((i) => `${i.name} ${i.amount}`).join(' · ')})
          </span>
          {d.prepared.map((p) => (
            <p key={p.name} className="small cs-batch-for">
              {p.name.toLowerCase()} : déjà préparé (session {when(p, props.moments)})
            </p>
          ))}
        </li>
      ))}
    </ul>
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
  const [daysBefore, setDaysBefore] = useState(s.daysBefore);
  const minDate = addDaysTo(s.from, -daysBefore);
  const [selection, setSelection] = useState(() =>
    initialSelection(s.entries, s.lastElements, addDaysTo(s.from, -s.daysBefore)),
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState(() => new Set(s.grid.slots.map(slotKey)));
  const [freezer, setFreezer] = useState(false);
  const [cookMoments, setCookMoments] = useState(() => new Set(s.cookMoments));
  const [proposal, setProposal] = useState<BatchProposalDto | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
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
  const elements = elementsOf(s.entries, minDate);
  const { couples } = forCalculation(s.entries, selection, minDate);
  const changed = () => {
    setProposal(null);
    setExcluded(new Set());
    setError(null);
  };
  /** « 7 repas · Riz 680 g »: the meals ticked (else all the meals of the element). */
  const summary = (el: Element) => {
    const basis = s.bases[el.key];
    const ticked = el.meals.filter((m) => selection.has(coupleKey(m.entry.entryId, m.part.prepId)));
    const list = ticked.length ? ticked : el.meals;
    const portions = list.reduce((n, m) => n + m.part.portions, 0);
    const amounts = basis ? amountsOf(cookLines(basis, portions), s.facts) : [];
    return `${el.meals.length} repas${amounts.length ? ` · ${amounts.map((a) => `${a.name} ${a.amount}`).join(' · ')}` : ''}`;
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
  const body = () => ({
    from: s.from,
    to: s.to,
    couples,
    slots: shownSlots,
    freezer,
    daysBefore,
    cookMoments: [...cookMoments],
  });
  const calculate = async () => {
    setBusy(true);
    setError(null);
    try {
      setProposal(await module.api.post<BatchProposalDto>('/batch/compute', body()));
      setExcluded(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const doubles = proposal?.doubles ?? [];
  const validate = () =>
    void props
      .run(() =>
        module.api.post('/batch/plans', {
          ...body(),
          doubles: doubles.filter((d) => !excluded.has(d.key)).map((d) => d.key),
          excludedDoubles: doubles.filter((d) => excluded.has(d.key)).map((d) => d.key),
        }),
      )
      .then((ok) => ok && props.reload());

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
              facts={s.facts}
              run={props.run}
              reload={props.reload}
            />
          ))}
        </Card>
      )}

      <Card title="1. Éléments de base">
        {elements.length === 0 ? (
          <EmptyState title="Aucun repas planifié sur cette période.">
            Planifie des repas dans l’onglet « Planning des repas ».
          </EmptyState>
        ) : (
          <>
            <p className="small muted">
              Ce que tu prépares d’avance en session : chaque préparation, et chaque recette non
              découpée, des repas de la période.
            </p>
            <div className="cs-row small">
              <Button
                small
                variant="secondary"
                onClick={() => (changed(), setSelection(selectAll(s.entries, minDate)))}
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
            </div>
            <ul className="cs-batch-elements">
              {elements.map((el) => {
                const state = elementState(selection, el);
                const covered = el.meals.filter((m) => m.covered).length;
                return (
                  <li key={el.key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={state === 'all' && el.keepKnown}
                        disabled={!el.keepKnown || covered === el.meals.length}
                        ref={(node) => {
                          if (node) node.indeterminate = state === 'partial';
                        }}
                        onChange={() => (changed(), setSelection(toggleElement(selection, el)))}
                      />{' '}
                      <strong>{el.name}</strong>
                    </label>{' '}
                    <span className="small">— {summary(el)}</span>{' '}
                    <button
                      type="button"
                      className="cs-link small"
                      aria-expanded={open.has(el.key)}
                      onClick={() => {
                        const next = new Set(open);
                        if (next.has(el.key)) next.delete(el.key);
                        else next.add(el.key);
                        setOpen(next);
                      }}
                    >
                      {open.has(el.key) ? 'masquer les repas' : 'voir les repas'}
                    </button>
                    {!el.keepKnown && (
                      <span className="small cs-batch-warning">
                        {' '}
                        <Icon name="warning" /> durée de conservation manquante —{' '}
                        <button
                          type="button"
                          className="cs-link"
                          onClick={() =>
                            el.prepId ? props.onEditPrep(el.prepId) : props.onEditMeal(el.mealId)
                          }
                        >
                          compléter la fiche
                        </button>
                      </span>
                    )}
                    {covered > 0 && (
                      <span className="small muted">
                        {' '}
                        · {covered} déjà couvert{covered > 1 ? 's' : ''} par un plan validé
                      </span>
                    )}
                    {open.has(el.key) && (
                      <ul className="small">
                        {el.meals.map((m) => (
                          <li key={m.entry.entryId}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selection.has(coupleKey(m.entry.entryId, m.part.prepId))}
                                disabled={m.covered || !el.keepKnown}
                                onChange={() => (changed(), setSelection(toggleMeal(selection, m)))}
                              />{' '}
                              {capitalised(shortDate(m.entry.date))} ·{' '}
                              {moments.get(m.entry.momentId)?.name} — {m.entry.mealName} (
                              {portionsText(m.part.portions)})
                              {m.entry.beforePeriod && ' · avant la période'}
                              {m.covered && ' · déjà couvert'}
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <Card title="2. Créneaux de cuisine">
        {shownSlots.length === 0 && (
          <p className="small muted">Coche les créneaux où tu peux faire une session.</p>
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
        <div className="cs-row small" role="group" aria-label="Moments où je cuisine mes repas">
          Doubles doses — je cuisine mes repas aux moments :
          {s.moments.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={cookMoments.has(m.id)}
                onChange={() => {
                  const next = new Set(cookMoments);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  setCookMoments(next);
                  changed();
                  // Remembered (a setting); no calculation.
                  void props.run(() =>
                    module.api.put('/batch/cook-moments', { moments: [...next] }),
                  );
                }}
              />{' '}
              {m.name}
            </label>
          ))}
        </div>
        <div className="cs-row">
          <Button onClick={() => void calculate()} disabled={busy || elements.length === 0}>
            Calculer
          </Button>
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
              <h4>Temps 1 — éléments de base</h4>
              {proposal.total === 0 ? (
                <p className="small muted">Aucun élément de base coché.</p>
              ) : (
                <p>
                  <strong>
                    {proposal.sessions.length} session{proposal.sessions.length > 1 ? 's' : ''}{' '}
                    couvre{proposal.sessions.length > 1 ? 'nt' : ''} {proposal.covered} repas sur{' '}
                    {proposal.total}
                  </strong>
                  {proposal.total - proposal.covered > 0 &&
                    ` ; ${proposal.total - proposal.covered} sans session possible`}
                  .
                </p>
              )}
              {proposal.sessions.map((session) => (
                <SessionCard
                  key={slotKey(session)}
                  session={session}
                  moments={moments}
                  facts={s.facts}
                />
              ))}
              {proposal.uncovered.length > 0 && (
                <ul className="small">
                  {proposal.uncovered.map((u) => (
                    <li key={`${u.entryId}|${u.prepId}`}>
                      {u.name} : {u.reason}
                    </li>
                  ))}
                </ul>
              )}
              <h4>Temps 2 — doubles doses</h4>
              {doubles.length === 0 ? (
                <p className="small muted">
                  Aucune double dose : aucun repas suivant ne peut profiter d’une cuisson au moment
                  d’un repas.
                </p>
              ) : (
                <Doubles
                  doubles={doubles}
                  moments={moments}
                  excluded={excluded}
                  onToggle={(key) => {
                    const next = new Set(excluded);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    setExcluded(next);
                  }}
                />
              )}
              <div className="cs-row">
                <Button
                  onClick={validate}
                  disabled={!proposal.sessions.length && doubles.every((d) => excluded.has(d.key))}
                >
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
  moments: Moments;
  facts: IngredientFacts;
  run: Run;
  reload: () => void;
}) {
  const module = useModule();
  const { plan } = props;
  const doubles = plan.doubles ?? [];
  return (
    <div className="cs-batch-plan">
      <div className="cs-row">
        <strong>
          {plan.sessions.length} session{plan.sessions.length > 1 ? 's' : ''}
          {doubles.length > 0 &&
            `, ${doubles.length} double${doubles.length > 1 ? 's' : ''} dose${doubles.length > 1 ? 's' : ''}`}
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
            facts={props.facts}
            onEdit={(change) =>
              void props.run(() => module.api.patch(`/batch/sessions/${session.id}`, change))
            }
          />
        </Fragment>
      ))}
      {doubles.length > 0 && <Doubles doubles={doubles} moments={props.moments} />}
    </div>
  );
}
