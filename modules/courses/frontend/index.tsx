// Courses: plan meals over a period (per day and moment, with portions), the
// shopping list generated from them (by aisle, ticked while shopping, extras
// and articles by hand, copy / export), the library of meals (search, tags,
// ingredient lines with autocompletion, cost and nutrition per portion) and
// the ingredients (unit, aisle, merge, piece weight, nutrition, price), the
// week's summary (facts only), the lists of earlier periods, import / export
// in JSON (preview first). Home card: today's meals.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  confirmDelete,
  copyText,
  defineFrontendModule,
  EmptyState,
  ErrorMessage,
  errorMessage,
  Page,
  StateBadge,
  UndoToast,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import { addDays, daysBetween, mondayOf, WEEKDAYS, weekdayOf } from '../shared/dates';
import { fold, UNITS } from '../shared/quantities';
import {
  defaultNutritionPer,
  formatEuros,
  NUTRIENTS,
  PRICE_PER,
  type Cost,
  type Facts,
} from '../shared/nutrition';
import type { Preview } from '../shared/exchange';
import type {
  IngredientDto,
  ListDto,
  MealDto,
  MomentDto,
  PastListDto,
  StateDto,
  SummaryDto,
} from '../shared/types';
import './courses.css';

type Run = (action: () => Promise<unknown>) => Promise<boolean>;
type Tab = 'plan' | 'list' | 'summary' | 'meals' | 'ingredients' | 'moments' | 'exchange';
const TABS: [Tab, string][] = [
  ['plan', 'Planning des repas'],
  ['list', 'Liste de courses'],
  ['summary', 'Résumé de la semaine'],
  ['meals', 'Repas'],
  ['ingredients', 'Ingrédients'],
  ['moments', 'Moments et extras'],
  ['exchange', 'Importer / exporter'],
];

/** « incomplet » with the names of what could not be counted. */
function Incomplete(props: { missing: string[]; what: string }) {
  if (!props.missing.length) return null;
  return (
    <span title={`${props.what} : ${props.missing.join(', ')}`}>
      <StateBadge tone="warning">incomplet</StateBadge>
    </span>
  );
}
const n0 = (v: number) => Math.round(v).toLocaleString('fr-FR');
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
function CostText(props: { cost: Cost }) {
  return (
    <>
      <span className="num">{formatEuros(props.cost.euros)}</span>{' '}
      <Incomplete
        missing={props.cost.missing}
        what="Sans prix (ou unité qui ne se convertit pas)"
      />
    </>
  );
}
function FactsText(props: { facts: Facts }) {
  const v = props.facts.values;
  return (
    <>
      <span className="num">
        {n0(v.kcal)} kcal · {n1(v.protein)} g prot.
      </span>{' '}
      <Incomplete missing={props.facts.missing} what="Valeurs nutritionnelles manquantes" />
    </>
  );
}
const dayLabel = (date: string) =>
  `${WEEKDAYS[weekdayOf(date) - 1]} ${new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;

function PeriodPicker(props: { list: ListDto; run: Run }) {
  const module = useModule();
  const set = (from: string, to: string) =>
    void props.run(() => module.api.put('/list', { from, to }));
  const monday = mondayOf(props.list.from);
  return (
    <div className="cs-row cs-period">
      <span className="small muted">Période</span>
      <input
        className="input input--short"
        type="date"
        value={props.list.from}
        aria-label="Du"
        onChange={(e) =>
          e.target.value &&
          set(e.target.value, props.list.to < e.target.value ? e.target.value : props.list.to)
        }
      />
      <span className="small muted">au</span>
      <input
        className="input input--short"
        type="date"
        value={props.list.to}
        aria-label="Au"
        onChange={(e) => e.target.value && set(props.list.from, e.target.value)}
      />
      <Button
        variant="secondary"
        small
        onClick={() => set(addDays(monday, -7), addDays(monday, -1))}
      >
        ‹ Semaine
      </Button>
      <Button
        variant="secondary"
        small
        onClick={() =>
          set(
            mondayOf(new Date().toISOString().slice(0, 10)),
            addDays(mondayOf(new Date().toISOString().slice(0, 10)), 6),
          )
        }
      >
        Cette semaine
      </Button>
      <Button
        variant="secondary"
        small
        onClick={() => set(addDays(monday, 7), addDays(monday, 13))}
      >
        Semaine ›
      </Button>
    </div>
  );
}

function PlanSlot(props: { date: string; moment: MomentDto; state: StateDto; run: Run }) {
  const module = useModule();
  const [meal, setMeal] = useState('');
  const [servings, setServings] = useState('1');
  const entries = props.state.plan.filter(
    (p) => p.date === props.date && p.momentId === props.moment.id,
  );
  const names = new Map(props.state.meals.map((m) => [m.id, m.name]));
  const add = () => {
    const found = props.state.meals.find((m) => fold(m.name) === fold(meal));
    if (!found) return;
    void props
      .run(() =>
        module.api.post('/plan', {
          date: props.date,
          momentId: props.moment.id,
          mealId: found.id,
          servings: Number(servings),
        }),
      )
      .then((ok) => ok && setMeal(''));
  };
  return (
    <td className="cs-slot">
      {entries.map((p) => (
        <span key={p.id} className="cs-entry">
          <span className="cs-entry__name">{names.get(p.mealId) ?? '?'}</span>
          <input
            className="cs-entry__servings num"
            type="number"
            min={0.5}
            max={50}
            step={0.5}
            defaultValue={p.servings}
            aria-label="Portions"
            title="Portions"
            onBlur={(e) =>
              Number(e.target.value) !== p.servings &&
              void props.run(() =>
                module.api.patch(`/plan/${p.id}`, { servings: Number(e.target.value) }),
              )
            }
          />
          <button
            type="button"
            className="cs-x"
            aria-label={`Retirer ${names.get(p.mealId)}`}
            onClick={() => void props.run(() => module.api.delete(`/plan/${p.id}`))}
          >
            ×
          </button>
        </span>
      ))}
      <span className="cs-row cs-slot__add">
        <input
          className="input cs-slot__meal"
          list="cs-meals"
          value={meal}
          placeholder="+ repas"
          aria-label={`Repas ${props.moment.name} ${props.date}`}
          onChange={(e) => setMeal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        {meal && (
          <>
            <input
              className="input cs-entry__servings num"
              type="number"
              min={0.5}
              step={0.5}
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              aria-label="Portions"
            />
            <Button
              small
              onClick={add}
              disabled={!props.state.meals.some((m) => fold(m.name) === fold(meal))}
            >
              OK
            </Button>
          </>
        )}
      </span>
    </td>
  );
}

function Planning(props: { state: StateDto; summary: SummaryDto | null; run: Run }) {
  const { state, summary } = props;
  const dayFacts = new Map((summary?.days ?? []).map((d) => [d.date, d]));
  const days = daysBetween(state.list.from, state.list.to);
  if (!state.meals.length)
    return (
      <EmptyState title="Pas encore de repas.">
        Crée-en dans l’onglet « Repas », puis planifie-les ici.
      </EmptyState>
    );
  return (
    <>
      <datalist id="cs-meals">
        {state.meals.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>
      <div className="cs-plan-wrap">
        <table className="cs-plan">
          <thead>
            <tr>
              <th />
              {state.moments.map((m) => (
                <th key={m.id}>
                  {m.name} <span className="small muted">{m.time}</span>
                </th>
              ))}
              <th className="small">Jour (estimé)</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d} className={d === state.today ? 'cs-plan__today' : undefined}>
                <th scope="row">{dayLabel(d)}</th>
                {state.moments.map((m) => (
                  <PlanSlot key={m.id} date={d} moment={m} state={state} run={props.run} />
                ))}
                <td className="cs-plan__facts small">
                  {dayFacts.get(d)?.meals ? (
                    <>
                      <FactsText facts={dayFacts.get(d)!.nutrition} />
                      <br />
                      <CostText cost={dayFacts.get(d)!.cost} />
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Les portions de chaque repas planifié ajustent les quantités de la liste (la recette est
        écrite pour son propre nombre de portions).
        {summary && (
          <>
            {' '}
            Période : <CostText cost={summary.total.cost} /> estimés (quantités utilisées, pas les
            paquets).
          </>
        )}
      </p>
    </>
  );
}

function PastLists(props: { run: Run; list: ListDto }) {
  const module = useModule();
  const data = useApi<{ lists: PastListDto[] }>(module.url(`/lists/history?l=${props.list.id}`));
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lists = data.data?.lists ?? [];
  if (!lists.length) return null;
  return (
    <Card title="Listes précédentes">
      <p className="small muted">
        Une liste par période : changer de période en donne une propre ; revenir sur une période
        rouvre sa liste. « Reprendre comme base » ajoute ses articles (ceux qui manquent) en extras
        de la liste en cours.
      </p>
      {notice && <p className="small muted">{notice}</p>}
      <ul className="cs-history">
        {lists.map((l) => (
          <li key={l.id}>
            <div className="cs-row">
              <button
                type="button"
                className="cs-link"
                aria-expanded={open === l.id}
                onClick={() => setOpen(open === l.id ? null : l.id)}
              >
                Du {dayLabel(l.from)} au {dayLabel(l.to)}
              </button>
              <span className="small muted">
                {l.groups.reduce((n, g) => n + g.items.length, 0)} articles
                {l.cost ? ` · ${formatEuros(l.cost.euros)} estimés` : ''}
              </span>
              <Button
                small
                variant="secondary"
                onClick={() =>
                  void props.run(async () => {
                    const r = await module.api.post<{ added: number }>(`/lists/${l.id}/reuse`);
                    setNotice(
                      r.added
                        ? `${r.added} article${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''} à la liste en cours.`
                        : 'Rien à ajouter : tout y est déjà.',
                    );
                  })
                }
              >
                Reprendre comme base
              </Button>
            </div>
            {open === l.id && (
              <ul className="cs-items small">
                {l.groups.flatMap((g) =>
                  g.items.map((i) => (
                    <li key={i.key} className={i.checked ? 'cs-list__done' : undefined}>
                      {i.checked ? '☑' : '☐'} {i.name}
                      {i.amount && <span className="muted"> — {i.amount}</span>}
                      <span className="muted"> · {g.aisle}</span>
                    </li>
                  )),
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ShoppingList(props: { list: ListDto; run: Run }) {
  const module = useModule();
  const { list } = props;
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const check = (key: string, checked: boolean) =>
    void props.run(() => module.api.post('/list/check', { key, checked }));
  const inList = new Set(
    list.groups.flatMap((g) =>
      g.items.filter((i) => i.source === 'extra').map((i) => fold(i.name)),
    ),
  );
  const count = list.groups.reduce((n, g) => n + g.items.length, 0);
  const left = list.groups.reduce((n, g) => n + g.items.filter((i) => !i.checked).length, 0);
  return (
    <>
      <div className="cs-row">
        <span className="small muted">
          {list.mealsPlanned} repas planifié{list.mealsPlanned > 1 ? 's' : ''} · {left} / {count}{' '}
          article{count > 1 ? 's' : ''} à prendre
        </span>
        <Button
          variant="secondary"
          small
          onClick={() =>
            void module.api
              .get<{ text: string }>('/list/text')
              .then(async ({ text }) =>
                setNotice((await copyText(text)) ? 'Liste copiée.' : 'Copie refusée.'),
              )
          }
        >
          Copier
        </Button>
        <Button
          variant="secondary"
          small
          onClick={() =>
            void props.run(async () => {
              const r = await module.api.post<{ path?: string }>('/list/export');
              setNotice(r.path ? `Enregistrée : ${r.path}` : 'Export annulé.');
            })
          }
        >
          Exporter (Markdown)…
        </Button>
        <Button
          variant="secondary"
          small
          onClick={() => void props.run(() => module.api.post('/list/uncheck-all'))}
        >
          Tout décocher
        </Button>
        {notice && <span className="small muted">{notice}</span>}
      </div>
      {list.mealsPlanned > 0 && (
        <p className="small">
          Coût estimé des repas : <CostText cost={list.cost} />{' '}
          <span className="muted">
            — sur les quantités utilisées, pas sur les paquets achetés ; extras non comptés.
          </span>
        </p>
      )}
      {list.habitual.length > 0 && (
        <div className="cs-row cs-habitual">
          <span className="small muted">Extras habituels :</span>
          {list.habitual.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`cs-chip${inList.has(fold(e.name)) ? ' cs-chip--on' : ''}`}
              disabled={inList.has(fold(e.name))}
              onClick={() =>
                void props.run(() =>
                  module.api.post('/list/extras', { name: e.name, aisle: e.aisle }),
                )
              }
            >
              {inList.has(fold(e.name)) ? '✓ ' : '+ '}
              {e.name}
            </button>
          ))}
        </div>
      )}
      <form
        className="cs-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void props
            .run(() => module.api.post('/list/extras', { name, qty }))
            .then((ok) => {
              if (ok) {
                setName('');
                setQty('');
              }
            });
        }}
      >
        <input
          className="input cs-grow"
          value={name}
          placeholder="Ajouter un article à la main"
          aria-label="Article"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input input--short"
          value={qty}
          placeholder="quantité"
          aria-label="Quantité"
          onChange={(e) => setQty(e.target.value)}
        />
        <Button small type="submit" disabled={!name.trim()}>
          Ajouter
        </Button>
      </form>
      {count === 0 ? (
        <EmptyState title="Liste vide.">
          Planifie des repas sur la période, ou ajoute des articles.
        </EmptyState>
      ) : (
        list.groups.map((g) => (
          <Card key={g.aisle} title={g.aisle}>
            <ul className="cs-list">
              {g.items.map((i) => (
                <li key={i.key} className={i.checked ? 'cs-list__done' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={i.checked}
                      onChange={(e) => check(i.key, e.target.checked)}
                    />{' '}
                    <span className="cs-list__name">{i.name}</span>
                    {i.amount && <span className="cs-list__qty num">{i.amount}</span>}
                    {i.source === 'extra' && <span className="small muted">extra</span>}
                  </label>
                  {i.id && (
                    <button
                      type="button"
                      className="cs-x"
                      aria-label={`Retirer ${i.name}`}
                      onClick={() =>
                        void props.run(() => module.api.delete(`/list/extras/${i.id}`))
                      }
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      <PastLists run={props.run} list={list} />
    </>
  );
}

interface Line {
  ingredientId: string;
  name: string;
  qty: string;
  unit: string;
}

function MealEditor(props: {
  meal: MealDto | null;
  state: StateDto;
  run: Run;
  onDone: () => void;
}) {
  const module = useModule();
  const byId = new Map(props.state.ingredients.map((i) => [i.id, i]));
  const [name, setName] = useState(props.meal?.name ?? '');
  const [servings, setServings] = useState(String(props.meal?.servings ?? 2));
  const [tags, setTags] = useState((props.meal?.tags ?? []).join(', '));
  const [note, setNote] = useState(props.meal?.note ?? '');
  const [lines, setLines] = useState<Line[]>(
    props.meal?.items.map((i) => ({
      ingredientId: i.ingredientId,
      name: byId.get(i.ingredientId)?.name ?? '',
      qty: String(i.qty),
      unit: i.unit,
    })) ?? [],
  );
  const set = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const pick = (index: number, value: string) => {
    const found = props.state.ingredients.find((i) => fold(i.name) === fold(value));
    set(
      index,
      found
        ? { name: found.name, ingredientId: found.id, unit: lines[index]!.unit || found.unit }
        : { name: value, ingredientId: '' },
    );
  };
  const save = () =>
    void props
      .run(() => {
        const body = {
          name,
          servings: Number(servings),
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          note,
          items: lines
            .filter((l) => l.name.trim())
            .map((l) => ({
              ingredientId: l.ingredientId || undefined,
              name: l.name,
              qty: Number(l.qty.replace(',', '.')),
              unit: l.unit || 'g',
            })),
        };
        return props.meal
          ? module.api.put(`/meals/${props.meal.id}`, body)
          : module.api.post('/meals', body);
      })
      .then((ok) => ok && props.onDone());
  return (
    <Card title={props.meal ? `Modifier « ${props.meal.name} »` : 'Nouveau repas'}>
      <datalist id="cs-ingredients">
        {props.state.ingredients.map((i) => (
          <option key={i.id} value={i.name} />
        ))}
      </datalist>
      <div className="cs-form">
        <div className="cs-row">
          <input
            className="input cs-grow"
            value={name}
            placeholder="Nom du repas (ex. Risotto aux champignons)"
            aria-label="Nom du repas"
            onChange={(e) => setName(e.target.value)}
          />
          <label className="small">
            Pour{' '}
            <input
              className="input input--short num"
              type="number"
              min={1}
              max={50}
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              aria-label="Portions de la recette"
            />{' '}
            portion(s)
          </label>
        </div>
        <input
          className="input"
          value={tags}
          placeholder="Tags séparés par des virgules (ex. VG, protéiné)"
          aria-label="Tags"
          onChange={(e) => setTags(e.target.value)}
        />
        <h4>Ingrédients</h4>
        {lines.map((l, i) => (
          <div key={i} className="cs-row">
            <input
              className="input cs-grow"
              list="cs-ingredients"
              value={l.name}
              placeholder="Ingrédient"
              aria-label="Ingrédient"
              onChange={(e) => pick(i, e.target.value)}
            />
            <input
              className="input input--short num"
              value={l.qty}
              placeholder="qté"
              aria-label="Quantité"
              onChange={(e) => set(i, { qty: e.target.value })}
            />
            <select
              className="input input--short"
              value={l.unit}
              aria-label="Unité"
              onChange={(e) => set(i, { unit: e.target.value })}
            >
              {[...new Set([...UNITS, l.unit].filter(Boolean))].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {l.name.trim() && !l.ingredientId && (
              <span className="small cs-new">nouvel ingrédient</span>
            )}
            <button
              type="button"
              className="cs-x"
              aria-label="Retirer la ligne"
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="cs-link small"
          onClick={() => setLines([...lines, { ingredientId: '', name: '', qty: '', unit: 'g' }])}
        >
          + Ajouter un ingrédient
        </button>
        <textarea
          className="input"
          rows={2}
          value={note}
          placeholder="Note (facultatif)"
          aria-label="Note"
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="ui-actions">
          <Button
            disabled={
              !name.trim() ||
              lines.some((l) => l.name.trim() && !(Number(l.qty.replace(',', '.')) > 0))
            }
            onClick={save}
          >
            Enregistrer
          </Button>
          <Button variant="secondary" onClick={props.onDone}>
            Annuler
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Meals(props: { state: StateDto; run: Run; onDeleted: (m: MealDto) => void }) {
  const module = useModule();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<MealDto | 'new' | null>(null);
  const [sort, setSort] = useState<'name' | 'cost' | 'protein'>('name');
  const [maxCost, setMaxCost] = useState('');
  const names = new Map(props.state.ingredients.map((i) => [i.id, i.name]));
  const tags = [...new Set(props.state.meals.flatMap((m) => m.tags))].sort();
  const limit = Number(maxCost.replace(',', '.'));
  const shown = props.state.meals
    .filter(
      (m) =>
        (!tag || m.tags.includes(tag)) &&
        (!maxCost.trim() || !(limit >= 0) || m.perServing.cost.euros <= limit) &&
        fold(
          `${m.name} ${m.tags.join(' ')} ${m.items.map((i) => names.get(i.ingredientId)).join(' ')}`,
        ).includes(fold(q)),
    )
    .sort((a, b) =>
      sort === 'cost'
        ? a.perServing.cost.euros - b.perServing.cost.euros
        : sort === 'protein'
          ? b.perServing.nutrition.values.protein - a.perServing.nutrition.values.protein
          : 0,
    );
  if (editing)
    return (
      <MealEditor
        meal={editing === 'new' ? null : editing}
        state={props.state}
        run={props.run}
        onDone={() => setEditing(null)}
      />
    );
  return (
    <>
      <div className="cs-row">
        <input
          className="input cs-grow"
          type="search"
          value={q}
          placeholder="Rechercher un repas ou un ingrédient"
          aria-label="Rechercher"
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          value={sort}
          aria-label="Trier"
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="name">Trier par nom</option>
          <option value="cost">Moins chers d’abord</option>
          <option value="protein">Plus protéinés d’abord</option>
        </select>
        <label className="small">
          Max{' '}
          <input
            className="input input--tiny num"
            value={maxCost}
            placeholder="€"
            aria-label="Coût maximal par portion"
            onChange={(e) => setMaxCost(e.target.value)}
          />{' '}
          € / portion
        </label>
        <Button onClick={() => setEditing('new')}>Nouveau repas</Button>
      </div>
      {tags.length > 0 && (
        <div className="cs-row">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className={`cs-chip${tag === t ? ' cs-chip--on' : ''}`}
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title={
            props.state.meals.length ? 'Aucun repas ne correspond.' : 'Aucun repas pour l’instant.'
          }
        />
      ) : (
        <div className="cs-meals">
          {shown.map((m) => (
            <Card
              key={m.id}
              title={m.name}
              actions={
                <span className="ui-actions">
                  <Button variant="secondary" small onClick={() => setEditing(m)}>
                    Modifier
                  </Button>
                  <Button
                    variant="danger"
                    small
                    onClick={() =>
                      confirmDelete(`le repas « ${m.name} »`) &&
                      void props
                        .run(() => module.api.delete(`/meals/${m.id}`))
                        .then((ok) => ok && props.onDeleted(m))
                    }
                  >
                    Supprimer
                  </Button>
                </span>
              }
            >
              <p className="small muted">
                Pour {m.servings} portion{m.servings > 1 ? 's' : ''}
                {m.tags.length ? ` · ${m.tags.map((t) => `#${t}`).join(' ')}` : ''}
              </p>
              <p className="small cs-facts">
                Par portion : <CostText cost={m.perServing.cost} /> ·{' '}
                <FactsText facts={m.perServing.nutrition} />
              </p>
              <ul className="cs-items small">
                {m.items.map((i) => (
                  <li key={i.id}>
                    {names.get(i.ingredientId) ?? '?'} —{' '}
                    <span className="num">
                      {String(i.qty).replace('.', ',')} {i.unit}
                    </span>
                  </li>
                ))}
              </ul>
              {m.note && <p className="small muted">{m.note}</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** Piece weight, nutrition (for 100 g or 100 ml) and reference price of an ingredient: all optional. */
function IngredientFacts(props: { ingredient: IngredientDto; run: Run; onDone: () => void }) {
  const module = useModule();
  const i = props.ingredient;
  const str = (v: number | null | undefined) =>
    v === null || v === undefined ? '' : String(v).replace('.', ',');
  const [pieceG, setPieceG] = useState(str(i.pieceG));
  const [per, setPer] = useState(i.nutritionPer);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(NUTRIENTS.map((n) => [n.key, str(i.nutrition[n.key])])),
  );
  const [price, setPrice] = useState(str(i.price));
  const [pricePer, setPricePer] = useState<string>(
    i.pricePer ??
      (defaultNutritionPer(i.unit) === '100ml'
        ? 'l'
        : i.unit === 'g' || i.unit === 'kg'
          ? 'kg'
          : 'pièce'),
  );
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const bad = [pieceG, price, ...Object.values(values)].some(
    (v) => v.trim() !== '' && !(Number(v.replace(',', '.')) >= 0),
  );
  return (
    <div className="cs-facts-editor">
      <div className="cs-row">
        <label className="small">
          Poids d’une pièce
          {i.unit !== 'pièce' && !['g', 'kg', 'ml', 'cl', 'l'].includes(i.unit)
            ? ` (d’un·e ${i.unit})`
            : ''}{' '}
          <input
            className="input input--tiny num"
            value={pieceG}
            placeholder="g"
            aria-label="Poids d’une pièce en grammes"
            onChange={(e) => setPieceG(e.target.value)}
          />{' '}
          g
        </label>
        <span className="small muted">pour convertir pièces ↔ poids (liste, nutrition, prix)</span>
      </div>
      <fieldset className="cs-nutrition">
        <legend className="small">
          Valeurs nutritionnelles pour{' '}
          <select
            className="input input--short"
            value={per}
            aria-label="Valeurs pour"
            onChange={(e) => setPer(e.target.value as typeof per)}
          >
            <option value="100g">100 g</option>
            <option value="100ml">100 ml</option>
          </select>{' '}
          <span className="muted">(toutes facultatives)</span>
        </legend>
        {NUTRIENTS.map((n) => (
          <label key={n.key} className="small">
            {n.label}
            <input
              className="input num"
              value={values[n.key] ?? ''}
              placeholder={n.unit}
              aria-label={`${n.label} (${n.unit})`}
              onChange={(e) => setValues({ ...values, [n.key]: e.target.value })}
            />
          </label>
        ))}
      </fieldset>
      <div className="cs-row">
        <label className="small">
          Prix de référence{' '}
          <input
            className="input input--tiny num"
            value={price}
            placeholder="€"
            aria-label="Prix de référence en euros"
            onChange={(e) => setPrice(e.target.value)}
          />{' '}
          € par{' '}
          <select
            className="input input--short"
            value={pricePer}
            aria-label="Prix par"
            onChange={(e) => setPricePer(e.target.value)}
          >
            {PRICE_PER.map((p) => (
              <option key={p} value={p}>
                {p === 'l' ? 'litre' : p}
              </option>
            ))}
          </select>
        </label>
        <span className="small muted">
          sert au coût estimé (quantités utilisées, pas les paquets)
        </span>
      </div>
      <div className="ui-actions">
        <Button
          small
          disabled={bad}
          onClick={() =>
            void props
              .run(() =>
                module.api.patch(`/ingredients/${i.id}`, {
                  pieceG: numOrNull(pieceG),
                  nutritionPer: per,
                  nutrition: Object.fromEntries(
                    Object.entries(values).map(([k, v]) => [k, numOrNull(v)]),
                  ),
                  price: numOrNull(price),
                  pricePer,
                }),
              )
              .then((ok) => ok && props.onDone())
          }
        >
          Enregistrer
        </Button>
        <Button small variant="secondary" onClick={props.onDone}>
          Fermer
        </Button>
      </div>
    </div>
  );
}

function Ingredients(props: { state: StateDto; run: Run }) {
  const module = useModule();
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('g');
  const [merge, setMerge] = useState<{ from: string; into: string } | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const uses = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of props.state.meals)
      for (const i of m.items) n.set(i.ingredientId, (n.get(i.ingredientId) ?? 0) + 1);
    return n;
  }, [props.state.meals]);
  const similar = props.state.ingredients.filter(
    (i) => name.trim() && fold(i.name).includes(fold(name)),
  );
  const patch = (i: IngredientDto, body: object) =>
    void props.run(() => module.api.patch(`/ingredients/${i.id}`, body));
  return (
    <>
      <form
        className="cs-row"
        onSubmit={(e) => {
          e.preventDefault();
          void props
            .run(() => module.api.post('/ingredients', { name, unit }))
            .then((ok) => ok && setName(''));
        }}
      >
        <input
          className="input cs-grow"
          value={name}
          placeholder="Nouvel ingrédient"
          aria-label="Nouvel ingrédient"
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="input input--short"
          value={unit}
          aria-label="Unité par défaut"
          onChange={(e) => setUnit(e.target.value)}
        >
          {UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <Button
          small
          type="submit"
          disabled={!name.trim() || similar.some((s) => fold(s.name) === fold(name))}
        >
          Ajouter
        </Button>
        {similar.length > 0 && (
          <span className="small muted">
            Déjà :{' '}
            {similar
              .slice(0, 4)
              .map((s) => s.name)
              .join(', ')}
          </span>
        )}
      </form>
      <input
        className="input"
        type="search"
        value={q}
        placeholder="Filtrer"
        aria-label="Filtrer les ingrédients"
        onChange={(e) => setQ(e.target.value)}
      />
      <table className="cs-table">
        <thead>
          <tr>
            <th>Ingrédient</th>
            <th>Unité</th>
            <th>Rayon</th>
            <th className="num">Repas</th>
            <th>Pièce · nutrition · prix</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.state.ingredients
            .filter((i) => fold(i.name).includes(fold(q)))
            .map((i) => (
              <Fragment key={i.id}>
                <tr>
                  <td>
                    <input
                      className="input"
                      defaultValue={i.name}
                      aria-label="Nom"
                      onBlur={(e) =>
                        e.target.value !== i.name && patch(i, { name: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="input input--short"
                      value={i.unit}
                      aria-label="Unité"
                      onChange={(e) => patch(i, { unit: e.target.value })}
                    >
                      {[...new Set([...UNITS, i.unit])].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      defaultValue={i.aisle}
                      placeholder="ex. Frais"
                      list="cs-aisles"
                      aria-label="Rayon"
                      onBlur={(e) =>
                        e.target.value !== i.aisle && patch(i, { aisle: e.target.value })
                      }
                    />
                  </td>
                  <td className="num">{uses.get(i.id) ?? 0}</td>
                  <td className="small">
                    <button
                      type="button"
                      className="cs-link"
                      aria-expanded={details === i.id}
                      onClick={() => setDetails(details === i.id ? null : i.id)}
                    >
                      {[
                        i.pieceG ? `${n1(i.pieceG)} g / pièce` : null,
                        Object.keys(i.nutrition).length
                          ? `nutrition ${Object.keys(i.nutrition).length}/8`
                          : null,
                        i.price !== null && i.pricePer
                          ? `${formatEuros(i.price)} / ${i.pricePer === 'l' ? 'litre' : i.pricePer}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Ajouter…'}
                    </button>
                  </td>
                  <td>
                    {merge?.from === i.id ? (
                      <span className="cs-row">
                        <select
                          className="input input--short"
                          value={merge.into}
                          aria-label="Fusionner dans"
                          onChange={(e) => setMerge({ from: i.id, into: e.target.value })}
                        >
                          <option value="">dans…</option>
                          {props.state.ingredients
                            .filter((x) => x.id !== i.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                        </select>
                        <Button
                          small
                          disabled={!merge.into}
                          onClick={() => {
                            const into = props.state.ingredients.find((x) => x.id === merge.into)!;
                            if (
                              window.confirm(
                                `Fusionner « ${i.name} » dans « ${into.name} » ? Ses lignes de repas passent à « ${into.name} ».`,
                              )
                            )
                              void props
                                .run(() => module.api.post('/ingredients/merge', merge))
                                .then(() => setMerge(null));
                          }}
                        >
                          Fusionner
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        small
                        onClick={() => setMerge({ from: i.id, into: '' })}
                      >
                        Fusionner…
                      </Button>
                    )}
                  </td>
                </tr>
                {details === i.id && (
                  <tr>
                    <td colSpan={6}>
                      <IngredientFacts
                        key={JSON.stringify(i)}
                        ingredient={i}
                        run={props.run}
                        onDone={() => setDetails(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
        </tbody>
      </table>
      <datalist id="cs-aisles">
        {[...new Set(props.state.ingredients.map((i) => i.aisle).filter(Boolean))].map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </>
  );
}

function MomentsAndExtras(props: { state: StateDto; run: Run }) {
  const module = useModule();
  const [moments, setMoments] = useState(props.state.moments);
  const [extra, setExtra] = useState('');
  const [aisle, setAisle] = useState('');
  return (
    <>
      <Card title="Moments des repas">
        <p className="small muted">
          L’heure et la durée par défaut servent au futur calendrier général.
        </p>
        {moments.map((m, i) => (
          <div key={m.id || i} className="cs-row">
            <input
              className="input"
              value={m.name}
              aria-label="Nom du moment"
              onChange={(e) =>
                setMoments(moments.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <input
              className="input input--short"
              type="time"
              value={m.time}
              aria-label="Heure par défaut"
              onChange={(e) =>
                setMoments(moments.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))
              }
            />
            <input
              className="input input--short num"
              type="number"
              min={5}
              max={240}
              value={m.durationMin}
              aria-label="Durée par défaut"
              onChange={(e) =>
                setMoments(
                  moments.map((x, j) =>
                    j === i ? { ...x, durationMin: Number(e.target.value) } : x,
                  ),
                )
              }
            />
            <span className="small muted">min</span>
            <button
              type="button"
              className="cs-x"
              aria-label={`Retirer ${m.name}`}
              onClick={() => setMoments(moments.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <div className="ui-actions">
          <Button
            variant="secondary"
            small
            onClick={() =>
              setMoments([...moments, { id: '', name: '', time: '10:00', durationMin: 15 }])
            }
          >
            + Moment
          </Button>
          <Button
            small
            disabled={moments.some((m) => !m.name.trim())}
            onClick={() => void props.run(() => module.api.put('/moments', { moments }))}
          >
            Enregistrer les moments
          </Button>
        </div>
      </Card>
      <Card title="Extras habituels">
        <p className="small muted">
          Articles hors repas (café, filtres…) à cocher vite dans la liste.
        </p>
        <form
          className="cs-row"
          onSubmit={(e) => {
            e.preventDefault();
            void props
              .run(() => module.api.post('/extras', { name: extra, aisle }))
              .then((ok) => ok && setExtra(''));
          }}
        >
          <input
            className="input"
            value={extra}
            placeholder="ex. Café"
            aria-label="Extra"
            onChange={(e) => setExtra(e.target.value)}
          />
          <input
            className="input input--short"
            value={aisle}
            placeholder="rayon"
            aria-label="Rayon"
            onChange={(e) => setAisle(e.target.value)}
          />
          <Button small type="submit" disabled={!extra.trim()}>
            Ajouter
          </Button>
        </form>
        <div className="cs-row">
          {props.state.list.habitual.map((e) => (
            <span key={e.id} className="cs-chip">
              {e.name}
              {e.aisle && <span className="small muted"> · {e.aisle}</span>}
              <button
                type="button"
                className="cs-x"
                aria-label={`Retirer ${e.name}`}
                onClick={() => void props.run(() => module.api.delete(`/extras/${e.id}`))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Card>
    </>
  );
}

/** Bars for one value per day (one series: no legend, the title names it), with an optional goal line. */
function DayBars(props: {
  title: string;
  unit: string;
  days: SummaryDto['days'];
  value: (d: SummaryDto['days'][number]) => number;
  goal: number;
  format: (v: number) => string;
}) {
  const values = props.days.map(props.value);
  const max = Math.max(1, props.goal * 1.15, ...values);
  return (
    <figure className="cs-bars" aria-label={props.title}>
      <figcaption className="small">
        <strong>{props.title}</strong>
        {props.goal > 0 && (
          <span className="muted">
            {' '}
            · objectif {props.format(props.goal)} {props.unit} (trait)
          </span>
        )}
      </figcaption>
      <div className="cs-bars__plot">
        {props.goal > 0 && (
          <span className="cs-bars__goal" style={{ bottom: `${(props.goal / max) * 100}%` }} />
        )}
        {props.days.map((d, i) => (
          <div
            key={d.date}
            className="cs-bars__col"
            title={`${dayLabel(d.date)} : ${props.format(values[i]!)} ${props.unit}`}
          >
            <span className="cs-bars__value small num">
              {d.meals ? props.format(values[i]!) : ''}
            </span>
            <span
              className={`cs-bars__bar${props.goal > 0 && values[i]! >= props.goal ? ' cs-bars__bar--over' : ''}`}
              style={{ height: `${(values[i]! / max) * 100}%` }}
            />
            <span className="cs-bars__label small muted">
              {dayLabel(d.date).split(' ')[0]!.slice(0, 3)}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** The period in figures: per day, totals, averages, meals by protein, goals. Facts only, no advice. */
function Summary(props: { summary: SummaryDto | null; run: Run }) {
  const module = useModule();
  const s = props.summary;
  const [goals, setGoals] = useState<Record<string, string> | null>(null);
  if (!s) return <p className="muted">Chargement…</p>;
  const filled = s.days.filter((d) => d.meals > 0);
  if (!filled.length)
    return (
      <EmptyState title="Rien de planifié sur la période.">
        Planifie des repas dans « Planning des repas » : le résumé se calcule tout seul.
      </EmptyState>
    );
  const nDays = s.days.length;
  const budget = s.goals.budgetPerWeek > 0 ? (s.goals.budgetPerWeek * nDays) / 7 : 0;
  const best = s.meals.slice(0, 3);
  const least = s.meals.length > 3 ? s.meals.slice(-3).reverse() : [];
  const missingNutrition = s.total.nutrition.missing;
  const vs = (value: number, goal: number) =>
    goal > 0 ? (value >= goal ? 'au-dessus' : 'en dessous') : null;
  const g = goals ?? {
    proteinPerDay: s.goals.proteinPerDay ? String(s.goals.proteinPerDay) : '',
    kcalPerDay: s.goals.kcalPerDay ? String(s.goals.kcalPerDay) : '',
    budgetPerWeek: s.goals.budgetPerWeek ? String(s.goals.budgetPerWeek).replace('.', ',') : '',
  };
  return (
    <>
      <p className="small muted">
        Du {dayLabel(s.from)} au {dayLabel(s.to)} · {filled.length} jour
        {filled.length > 1 ? 's' : ''} avec des repas planifiés (les moyennes portent sur ces
        jours). Des chiffres calculés depuis tes recettes et tes ingrédients, sans aucun conseil.
        {missingNutrition.length > 0 && (
          <> Incomplet : {missingNutrition.join(', ')} sans (toutes les) valeurs nutritionnelles.</>
        )}
      </p>
      <div className="cs-kpis">
        <div>
          <span className="cs-kpis__value num">{n0(s.average.nutrition.kcal)}</span>
          <span className="small muted">kcal / jour en moyenne</span>
        </div>
        <div>
          <span className="cs-kpis__value num">{n1(s.average.nutrition.protein)} g</span>
          <span className="small muted">protéines / jour en moyenne</span>
        </div>
        <div>
          <span className="cs-kpis__value num">{formatEuros(s.total.cost.euros)}</span>
          <span className="small muted">
            coût estimé de la période
            {budget > 0 &&
              ` (budget ${formatEuros(budget)} : ${vs(budget, s.total.cost.euros) === 'au-dessus' ? 'en dessous du budget' : 'au-dessus du budget'})`}
          </span>
        </div>
        <div>
          <span className="cs-kpis__value num">{formatEuros(s.average.cost)}</span>
          <span className="small muted">par jour en moyenne</span>
        </div>
      </div>
      {s.total.cost.missing.length > 0 && (
        <p className="small muted">
          Coût incomplet : {s.total.cost.missing.join(', ')} sans prix (ou unité qui ne se convertit
          pas). Estimation sur les quantités utilisées, pas sur les paquets.
        </p>
      )}
      <div className="cs-charts">
        <DayBars
          title="Protéines par jour"
          unit="g"
          days={s.days}
          value={(d) => d.nutrition.values.protein}
          goal={s.goals.proteinPerDay}
          format={n1}
        />
        <DayBars
          title="Calories par jour"
          unit="kcal"
          days={s.days}
          value={(d) => d.nutrition.values.kcal}
          goal={s.goals.kcalPerDay}
          format={n0}
        />
      </div>
      <div className="cs-plan-wrap">
        <table className="cs-table cs-summary">
          <thead>
            <tr>
              <th>Jour</th>
              <th className="num">Repas</th>
              <th className="num">kcal</th>
              <th className="num">Protéines</th>
              <th className="num">Glucides</th>
              <th className="num">Lipides</th>
              <th className="num">Fibres</th>
              <th className="num">Coût</th>
            </tr>
          </thead>
          <tbody>
            {s.days.map((d) => {
              const v = d.nutrition.values;
              const p = d.meals ? vs(v.protein, s.goals.proteinPerDay) : null;
              const k = d.meals ? vs(v.kcal, s.goals.kcalPerDay) : null;
              return (
                <tr key={d.date} className={d.meals ? undefined : 'muted'}>
                  <th scope="row">{dayLabel(d.date)}</th>
                  <td className="num">{d.meals}</td>
                  <td className="num">
                    {d.meals ? n0(v.kcal) : '—'}
                    {k && (
                      <span className={`cs-vs cs-vs--${k === 'au-dessus' ? 'over' : 'under'}`}>
                        {' '}
                        {k === 'au-dessus' ? '▲' : '▼'}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {d.meals ? `${n1(v.protein)} g` : '—'}
                    {p && (
                      <span className={`cs-vs cs-vs--${p === 'au-dessus' ? 'over' : 'under'}`}>
                        {' '}
                        {p === 'au-dessus' ? '▲' : '▼'}
                      </span>
                    )}
                  </td>
                  <td className="num">{d.meals ? `${n1(v.carbs)} g` : '—'}</td>
                  <td className="num">{d.meals ? `${n1(v.fat)} g` : '—'}</td>
                  <td className="num">{d.meals ? `${n1(v.fiber)} g` : '—'}</td>
                  <td className="num">{d.meals ? formatEuros(d.cost.euros) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">{s.days.reduce((n, d) => n + d.meals, 0)}</td>
              <td className="num">{n0(s.total.nutrition.values.kcal)}</td>
              <td className="num">{n1(s.total.nutrition.values.protein)} g</td>
              <td className="num">{n1(s.total.nutrition.values.carbs)} g</td>
              <td className="num">{n1(s.total.nutrition.values.fat)} g</td>
              <td className="num">{n1(s.total.nutrition.values.fiber)} g</td>
              <td className="num">{formatEuros(s.total.cost.euros)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(s.goals.proteinPerDay > 0 || s.goals.kcalPerDay > 0) && (
        <p className="small muted">
          ▲ au-dessus de l’objectif · ▼ en dessous (jours avec des repas).
        </p>
      )}
      <div className="cs-meals">
        <Card title="Repas planifiés les plus protéinés (par portion)">
          <ol className="cs-items small">
            {best.map((m) => (
              <li key={m.id}>
                {m.name} — <span className="num">{n1(m.proteinPerServing)} g</span>
                {m.missing && <span className="muted"> (incomplet)</span>}
              </li>
            ))}
          </ol>
        </Card>
        {least.length > 0 && (
          <Card title="Les moins protéinés (par portion)">
            <ol className="cs-items small">
              {least.map((m) => (
                <li key={m.id}>
                  {m.name} — <span className="num">{n1(m.proteinPerServing)} g</span>
                  {m.missing && <span className="muted"> (incomplet)</span>}
                </li>
              ))}
            </ol>
          </Card>
        )}
        <Card title="Mes objectifs (facultatifs)">
          <form
            className="cs-goals"
            onSubmit={(e) => {
              e.preventDefault();
              const num = (v: string | undefined) => Number((v ?? '').replace(',', '.')) || 0;
              void props
                .run(() =>
                  module.api.put('/goals', {
                    proteinPerDay: num(g.proteinPerDay),
                    kcalPerDay: num(g.kcalPerDay),
                    budgetPerWeek: num(g.budgetPerWeek),
                  }),
                )
                .then((ok) => ok && setGoals(null));
            }}
          >
            <label className="small">
              Protéines par jour{' '}
              <input
                className="input input--tiny num"
                value={g.proteinPerDay}
                placeholder="g"
                aria-label="Objectif protéines par jour"
                onChange={(e) => setGoals({ ...g, proteinPerDay: e.target.value })}
              />{' '}
              g
            </label>
            <label className="small">
              Calories par jour{' '}
              <input
                className="input input--tiny num"
                value={g.kcalPerDay}
                placeholder="kcal"
                aria-label="Objectif calories par jour"
                onChange={(e) => setGoals({ ...g, kcalPerDay: e.target.value })}
              />{' '}
              kcal
            </label>
            <label className="small">
              Budget par semaine{' '}
              <input
                className="input input--tiny num"
                value={g.budgetPerWeek}
                placeholder="€"
                aria-label="Budget par semaine"
                onChange={(e) => setGoals({ ...g, budgetPerWeek: e.target.value })}
              />{' '}
              €
            </label>
            <Button small type="submit" disabled={!goals}>
              Enregistrer
            </Button>
            <span className="small muted">
              Vide = pas d’objectif. Aussi dans Réglages &gt; Courses.
            </span>
          </form>
        </Card>
      </div>
    </>
  );
}

/** Import (preview first, then only what is confirmed) and export, in the documented JSON format. */
function Exchange(props: { run: Run }) {
  const module = useModule();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [replace, setReplace] = useState<Set<string>>(new Set());
  const [create, setCreate] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const example = useApi<unknown>(showHelp ? module.url('/example-json') : null);
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setter(next);
  };
  const look = (value: string) =>
    void props.run(async () => {
      setNotice(null);
      const p = await module.api.post<Preview>('/import/preview', { text: value });
      setPreview(p);
      setOverwrite(new Set());
      setReplace(new Set());
      // Creating a missing ingredient adds, it overwrites nothing: offered ticked.
      setCreate(new Set(p.toCreate.map((c) => c.name)));
    });
  const count = (status: string) =>
    preview?.ingredients.filter((i) => i.status === status).length ?? 0;
  const recipes = (status: string) =>
    preview?.recipes.filter((r) => r.status === status).length ?? 0;
  const skipped = preview?.recipes.filter((r) => r.unknown.some((u) => !create.has(u))) ?? [];
  return (
    <>
      <Card title="Importer des ingrédients et des recettes (JSON)">
        <p className="small muted">
          Rien n’est écrit avant « Importer » : d’abord un aperçu. Les éléments déjà là ne sont
          changés que si tu les coches. Une sauvegarde de la base est faite juste avant.
        </p>
        <div className="cs-row">
          <label className="button button--secondary button--small">
            Choisir un fichier…
            <input
              type="file"
              accept=".json,application/json"
              className="cs-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                void file.text().then((t) => {
                  setText(t);
                  look(t);
                });
                e.target.value = '';
              }}
            />
          </label>
          {fileName && <span className="small muted">{fileName}</span>}
          <Button small variant="secondary" onClick={() => setShowHelp(!showHelp)}>
            {showHelp ? 'Masquer le format' : 'Format du fichier (aide)'}
          </Button>
          <Button
            small
            variant="secondary"
            onClick={() =>
              void props.run(async () => {
                const r = await module.api.post<{ path?: string }>('/example-json');
                setNotice(r.path ? `Exemple enregistré : ${r.path}` : 'Enregistrement annulé.');
              })
            }
          >
            Télécharger l’exemple…
          </Button>
        </div>
        <textarea
          className="input"
          rows={4}
          value={text}
          placeholder="…ou colle ici le contenu JSON"
          aria-label="Contenu JSON"
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
        />
        <div className="ui-actions">
          <Button small variant="secondary" disabled={!text.trim()} onClick={() => look(text)}>
            Voir l’aperçu
          </Button>
        </div>
        {notice && <p className="small">{notice}</p>}
        {preview && (
          <div className="cs-preview">
            <p className="small">
              <strong>Aperçu</strong> · ingrédients : {count('new')} à ajouter, {count('same')} déjà
              là (identiques), {count('differs')} à fusionner · recettes : {recipes('new')} à
              ajouter, {recipes('same')} identiques, {recipes('differs')} différentes ·{' '}
              {preview.errors.length} erreur{preview.errors.length > 1 ? 's' : ''}
            </p>
            {preview.errors.length > 0 && (
              <ul className="cs-errors small">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    {e.line !== null ? `Ligne ${e.line} — ` : ''}
                    {e.where} : {e.message} <span className="muted">(ignoré)</span>
                  </li>
                ))}
              </ul>
            )}
            {count('differs') > 0 && (
              <fieldset className="cs-choices">
                <legend className="small">
                  Ingrédients déjà là avec d’autres valeurs : cocher pour remplacer par celles du
                  fichier (sinon gardés tels quels)
                </legend>
                {preview.ingredients
                  .filter((i) => i.status === 'differs')
                  .map((i) => (
                    <label key={i.name} className="small">
                      <input
                        type="checkbox"
                        checked={overwrite.has(i.name)}
                        onChange={() => toggle(overwrite, setOverwrite, i.name)}
                      />{' '}
                      <strong>{i.name}</strong>{' '}
                      <span className="muted">({i.changes.join(' ; ')})</span>
                    </label>
                  ))}
              </fieldset>
            )}
            {recipes('differs') > 0 && (
              <fieldset className="cs-choices">
                <legend className="small">
                  Recettes déjà là, différentes : cocher pour remplacer
                </legend>
                {preview.recipes
                  .filter((r) => r.status === 'differs')
                  .map((r) => (
                    <label key={r.name} className="small">
                      <input
                        type="checkbox"
                        checked={replace.has(r.name)}
                        onChange={() => toggle(replace, setReplace, r.name)}
                      />{' '}
                      <strong>{r.name}</strong>
                    </label>
                  ))}
              </fieldset>
            )}
            {preview.toCreate.length > 0 && (
              <fieldset className="cs-choices">
                <legend className="small">
                  Ingrédients des recettes absents du catalogue : à créer ? (décoché = la recette
                  qui l’utilise n’est pas importée)
                </legend>
                {preview.toCreate.map((c) => (
                  <label key={c.name} className="small">
                    <input
                      type="checkbox"
                      checked={create.has(c.name)}
                      onChange={() => toggle(create, setCreate, c.name)}
                    />{' '}
                    {c.name} <span className="muted">({c.unit})</span>
                  </label>
                ))}
              </fieldset>
            )}
            {skipped.length > 0 && (
              <p className="small muted">
                Non importées : {skipped.map((r) => r.name).join(', ')}.
              </p>
            )}
            <div className="ui-actions">
              <Button
                disabled={
                  count('new') + count('differs') + recipes('new') + recipes('differs') === 0
                }
                onClick={() => {
                  const changes = overwrite.size + replace.size;
                  if (
                    changes > 0 &&
                    !window.confirm(
                      `Remplacer ${changes} élément${changes > 1 ? 's' : ''} déjà là par les valeurs du fichier ?\n\nUne sauvegarde de la base est faite avant.`,
                    )
                  )
                    return;
                  void props.run(async () => {
                    const r = await module.api.post<{
                      ingredientsAdded: number;
                      ingredientsUpdated: number;
                      ingredientsCreated: number;
                      recipesAdded: number;
                      recipesReplaced: number;
                      recipesSkipped: string[];
                      backup: string;
                    }>('/import/apply', {
                      text,
                      overwrite: [...overwrite],
                      replaceRecipes: [...replace],
                      create: [...create],
                    });
                    setPreview(null);
                    setNotice(
                      `Importé : ${r.ingredientsAdded + r.ingredientsCreated} ingrédient(s) ajouté(s), ${r.ingredientsUpdated} remplacé(s), ${r.recipesAdded} recette(s) ajoutée(s), ${r.recipesReplaced} remplacée(s)${r.recipesSkipped.length ? `, non importées : ${r.recipesSkipped.join(', ')}` : ''}. Sauvegarde avant import : ${r.backup}.`,
                    );
                  });
                }}
              >
                Importer
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card title="Exporter">
        <p className="small muted">
          Tous les ingrédients (avec poids d’une pièce, nutrition, prix) et toutes les recettes,
          dans le même format : réimportable sans perte.
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            void props.run(async () => {
              const r = await module.api.post<{ path?: string }>('/export-json');
              setNotice(r.path ? `Exporté : ${r.path}` : 'Export annulé.');
            })
          }
        >
          Exporter (JSON)…
        </Button>
      </Card>
      {showHelp && (
        <Card title="Format du fichier">
          <div className="cs-help small">
            <p>
              Un objet JSON avec deux listes, <code>ingredients</code> et <code>recipes</code>{' '}
              (l’une peut manquer). Un élément en erreur est ignoré, les autres sont importés ; les
              noms se comparent sans accents ni majuscules.
            </p>
            <p>
              <strong>Ingrédient</strong> : <code>name</code> (obligatoire), <code>unit</code> (g,
              kg, ml, cl, l, pièce, boîte…, défaut g), <code>aisle</code> (rayon),{' '}
              <code>pieceWeightG</code> (poids moyen d’une pièce en g), <code>nutritionPer</code> («
              100g » ou « 100ml »), <code>nutrition</code> : <code>kcal</code>, <code>protein</code>
              , <code>carbs</code>, <code>sugars</code>, <code>fat</code>, <code>saturated</code>,{' '}
              <code>fiber</code>, <code>salt</code> (toutes facultatives, en g sauf kcal),{' '}
              <code>price</code> : <code>{'{ "amount": 3.2, "per": "kg" }'}</code> (per = kg, l ou
              pièce).
            </p>
            <p>
              <strong>Recette</strong> : <code>name</code>, <code>servings</code> (portions, entier
              de 1 à 50), <code>tags</code> (liste), <code>note</code>, <code>ingredients</code> :
              liste de <code>{'{ "name", "qty", "unit" }'}</code> (par nom ; un nom inconnu est
              proposé à la création).
            </p>
            {example.data != null && (
              <pre className="cs-code">{JSON.stringify(example.data, null, 2)}</pre>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function CoursesPage() {
  const module = useModule();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'plan') as Tab;
  const data = useApi<StateDto>(module.url('/state'));
  const summary = useApi<SummaryDto>(
    tab === 'plan' || tab === 'summary' ? module.url('/summary') : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<MealDto | null>(null);
  const run: Run = async (action) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      data.reload();
      summary.reload();
    }
  };
  // Another tab: fresh figures (the assistant or the planning may have changed them).
  const { reload } = data;
  useEffect(() => reload(), [tab, reload]);
  const s = data.data;
  return (
    <Page title="Courses" subtitle="Choisis des repas, la liste se fait toute seule.">
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {data.error && <ErrorMessage>{data.error}</ErrorMessage>}
      <nav className="cs-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setParams({ tab: id })}
          >
            {label}
          </button>
        ))}
      </nav>
      {s && (
        <>
          {(tab === 'plan' || tab === 'list' || tab === 'summary') && (
            <PeriodPicker list={s.list} run={run} />
          )}
          {tab === 'plan' && <Planning state={s} summary={summary.data ?? null} run={run} />}
          {tab === 'summary' && <Summary summary={summary.data ?? null} run={run} />}
          {tab === 'exchange' && <Exchange run={run} />}
          {tab === 'list' && <ShoppingList list={s.list} run={run} />}
          {tab === 'meals' && <Meals state={s} run={run} onDeleted={setUndo} />}
          {tab === 'ingredients' && <Ingredients state={s} run={run} />}
          {tab === 'moments' && (
            <MomentsAndExtras key={s.moments.map((m) => m.id).join()} state={s} run={run} />
          )}
        </>
      )}
      {undo && (
        <UndoToast
          message={`Repas supprimé : « ${undo.name} »`}
          onUndo={() => void run(() => module.api.post(`/meals/${undo.id}/restore`))}
          onDismiss={() => setUndo(null)}
        />
      )}
    </Page>
  );
}

function HomeWidget() {
  const module = useModule();
  const { data } = useApi<{ meals: { moment: string; name: string; servings: number }[] }>(
    module.url('/home'),
  );
  if (!data) return null;
  if (!data.meals.length) return <p className="small muted">Aucun repas planifié aujourd’hui.</p>;
  return (
    <ul className="cs-home small">
      {data.meals.map((m, i) => (
        <li key={i}>
          <span className="muted">{m.moment} :</span> {m.name}
        </li>
      ))}
    </ul>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: CoursesPage }],
  HomeWidget,
});
