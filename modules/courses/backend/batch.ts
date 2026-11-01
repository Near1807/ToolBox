// Batch cooking (onglet « Batch ») : the form's data, the calculation (it
// PROPOSES, it changes nothing: neither the planning, nor the lists, nor the
// portions), the cooking slots of a period and the usual model, the validated
// plans (several per period, never covering the same meal), the « sortir du
// congélateur » reminders and the sessions given to ctx.calendar — both only
// once a plan is validated. Optimisation: shared/batch.ts (exact).
import {
  type CalendarEvent,
  HttpError,
  type ModuleContext,
  requestBody,
  type SyncRow,
  type SyncStore,
} from '@hub/sdk/backend';
import { planBatch, type BatchMeal } from '../shared/batch';
import {
  addDaysTo,
  gridDates,
  modelFromSlots,
  parseModel,
  projectModel,
} from '../shared/batch-grid';
import {
  addUp,
  fold,
  formatAmount,
  plannedLines,
  scale,
  type Line,
  type MealRecipe,
  type PieceWeights,
} from '../shared/quantities';
import { expandRecipe, prepPortions } from '../shared/recipe';
import type {
  BatchCookDto,
  BatchEntryDto,
  BatchPartDto,
  BatchPlanDto,
  BatchProposalDto,
  BatchSessionDto,
  BatchSlotDto,
  BatchStateDto,
  MealDto,
  MomentDto,
  PlanDto,
  PrepDto,
  ThawDto,
} from '../shared/types';

interface GridRow extends SyncRow {
  date_from: string;
  date_to: string;
  /** JSON { dates, slots }: the dates shown when saved, and the slots ticked. */
  slots: string;
}
interface PlanRow extends SyncRow {
  date_from: string;
  date_to: string;
  freezer: number;
  days_before: number;
  /** JSON { dates, slots }: the grid really used. */
  grid: string;
}
interface SessionRow extends SyncRow {
  plan_id: string;
  date: string;
  moment_id: string;
  start_time: string | null;
  duration_min: number | null;
}
interface PortionRow extends SyncRow {
  session_id: string;
  plan_entry_id: string;
  meal_id: string;
  date: string;
  moment_id: string;
  servings: number;
  frozen: number;
  /** v0.27: the preparation cooked (null: the whole recipe, as in v0.26). */
  prep_id: string | null;
  /** v0.27, JSON Basis: what the plan was computed on (null: a v0.26 plan). */
  basis: string | null;
}
/** What a validated portion was computed on, to say when the recipes changed since. */
interface Basis {
  /** Portions cooked for this meal (of the preparation, or of the recipe). */
  portions: number;
  /** Preparation only: its line in the recipe, the recipe's servings, its composition. */
  lineQty?: number;
  recipeServings?: number;
  composition?: string;
}

export interface BatchDeps {
  ctx: ModuleContext;
  store: SyncStore;
  live: <R>(table: string, where?: string, ...args: unknown[]) => R[];
  meals: () => MealDto[];
  preps: () => PrepDto[];
  moments: () => MomentDto[];
  planBetween: (from: string, to: string) => PlanDto[];
  ingredientNames: () => Map<string, string>;
  pieceWeights: () => PieceWeights;
  /** The period of the list in use (default of the tab). */
  period: () => { from: string; to: string };
}

/** What a cooking is about: a preparation, or a whole recipe (no preparation). */
interface CookKey {
  prepId: string | null;
  mealId: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS_BEFORE = 7;
const isBatchTag = (tag: string) => fold(tag).replace(/^#/, '') === 'batch';
const frDate = (date: string) => date.split('-').reverse().join('/');

export function createBatch(d: BatchDeps) {
  const { ctx, store, live } = d;

  const settingDaysBefore = () => {
    const n = Number(ctx.settings.get<number>('batchDaysBefore') ?? 0);
    return Number.isInteger(n) && n >= 0 && n <= MAX_DAYS_BEFORE ? n : 0;
  };
  const model = () => parseModel(ctx.settings.get<string>('batchGridModel') ?? '{}');

  const periodFrom = (value: { from?: unknown; to?: unknown }) => {
    const from = String(value.from ?? '');
    const to = String(value.to ?? '');
    if (!DAY.test(from) || !DAY.test(to) || from > to) return d.period();
    return { from, to };
  };
  const daysBeforeFrom = (value: unknown) => {
    if (value === undefined) return settingDaysBefore();
    const n = Number(value);
    if (!(Number.isInteger(n) && n >= 0 && n <= MAX_DAYS_BEFORE))
      throw new HttpError(400, 'Sessions avant la période : de 0 à 7 jours');
    return n;
  };
  const slotsFrom = (value: unknown, dates: readonly string[]): BatchSlotDto[] => {
    if (!Array.isArray(value)) return [];
    const momentIds = new Set(d.moments().map((m) => m.id));
    const allowed = new Set(dates);
    const seen = new Set<string>();
    return (value as { date?: unknown; momentId?: unknown }[]).flatMap((s) => {
      const date = String(s?.date ?? '');
      const momentId = String(s?.momentId ?? '');
      const key = `${date}|${momentId}`;
      if (!allowed.has(date) || !momentIds.has(momentId) || seen.has(key)) return [];
      seen.add(key);
      return [{ date, momentId }];
    });
  };

  // --- What is cooked -----------------------------------------------------------------

  /**
   * The parts of a planned meal the batch can cook: each preparation of a
   * split recipe (portions = its line × portions planned / servings of the
   * recipe; the direct lines are cooked at meal time), else the whole recipe
   * (the v0.26 block, its own keeping).
   */
  const partsOf = (m: MealDto | undefined, servings: number): BatchPartDto[] => {
    if (!m) return [];
    if (!m.split)
      return [
        {
          prepId: null,
          mealId: m.id,
          name: m.name,
          portions: servings,
          fridgeDays: m.fridgeDays,
          freezable: m.freezable,
          freezerDays: m.freezerDays,
        },
      ];
    const preps = new Map(d.preps().map((p) => [p.id, p]));
    return [...prepPortions(m.lines)].flatMap(([prepId, qty]) => {
      const p = preps.get(prepId);
      if (!p) return [];
      return [
        {
          prepId,
          mealId: m.id,
          name: p.name,
          portions: Math.round(scale(qty, m.servings, servings) * 1e9) / 1e9,
          fridgeDays: p.fridgeDays,
          freezable: p.freezable,
          freezerDays: p.freezerDays,
        },
      ];
    });
  };
  const keyOf = (id: string): CookKey =>
    id.startsWith('prep:')
      ? { prepId: id.slice(5), mealId: null }
      : { prepId: null, mealId: id.slice(5) };
  const compositionOf = (p: PrepDto) =>
    JSON.stringify(p.items.map((i) => [i.ingredientId, i.qty, i.unit]));

  // --- Plans --------------------------------------------------------------------------

  const plansTouching = (from: string, to: string) =>
    live<PlanRow>('batch_plans', 'date_from <= ? AND date_to >= ?', to, from).sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  const sessionsOf = (planId: string) =>
    live<SessionRow>('batch_sessions', 'plan_id = ?', planId).sort(
      (a, b) => a.date.localeCompare(b.date) || order(a.moment_id) - order(b.moment_id),
    );
  const portionsOf = (sessionId: string) =>
    live<PortionRow>('batch_portions', 'session_id = ?', sessionId);
  const order = (momentId: string) => d.moments().findIndex((m) => m.id === momentId);
  /** Planned meals already covered by a validated plan: entry → plan. */
  const coveredEntries = () => {
    const covered = new Map<string, string>();
    for (const plan of live<PlanRow>('batch_plans'))
      for (const session of sessionsOf(plan.id))
        for (const p of portionsOf(session.id)) covered.set(p.plan_entry_id, plan.id);
    return covered;
  };

  /**
   * What to prepare, through the expansion of the recipes: a recipe scaled
   * to its portions (the list's own calculation), or a preparation × its
   * portions (expandRecipe of one line « preparation × portions »).
   */
  const ingredientsFor = (key: CookKey, portions: number) => {
    const names = d.ingredientNames();
    let lines: Line[];
    if (key.prepId) {
      const preps = new Map(d.preps().map((p) => [p.id, p]));
      lines = expandRecipe(
        [{ kind: 'prep', id: 'cook', prepId: key.prepId, qty: portions }],
        preps,
      );
    } else {
      const recipes = new Map<string, MealRecipe>(d.meals().map((m) => [m.id, m]));
      lines = plannedLines([{ mealId: key.mealId!, servings: portions }], recipes);
    }
    return addUp(lines, d.pieceWeights())
      .map((t) => ({
        name: names.get(t.ingredientId) ?? 'Ingrédient supprimé',
        amount: t.amounts.map(formatAmount).join(' + '),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  };
  /** Portions added up without the floating point dust (shown rounded anyway). */
  const total = (uses: readonly { servings: number }[]) =>
    Math.round(uses.reduce((n, u) => n + u.servings, 0) * 1e9) / 1e9;
  const cookDto = (
    key: CookKey,
    fridge: BatchCookDto['fridge'],
    frozen: BatchCookDto['frozen'],
    entryMeals: ReadonlyMap<string, string>,
  ): BatchCookDto => {
    const portions = total([...fridge, ...frozen]);
    const meals = d.meals();
    const name = key.prepId
      ? (d.preps().find((p) => p.id === key.prepId)?.name ?? 'Préparation supprimée')
      : (meals.find((m) => m.id === key.mealId)?.name ?? 'Repas supprimé');
    const mealName = new Map(meals.map((m) => [m.id, m.name]));
    return {
      mealId: key.mealId,
      mealName: name,
      prepId: key.prepId,
      portions,
      fridge,
      frozen,
      ingredients: ingredientsFor(key, portions),
      usedIn: [
        ...new Set(
          [...fridge, ...frozen].map(
            (u) => mealName.get(entryMeals.get(u.entryId) ?? '') ?? 'Repas supprimé',
          ),
        ),
      ].sort((a, b) => a.localeCompare(b, 'fr')),
    };
  };
  /** A session before the period already planned by another validated plan: said, never merged. */
  const overlapWarnings = (
    session: BatchSlotDto,
    from: string,
    exceptPlan: string | null,
  ): string[] => {
    if (session.date >= from) return [];
    return live<SessionRow>(
      'batch_sessions',
      'date = ? AND moment_id = ?',
      session.date,
      session.momentId,
    ).flatMap((other) => {
      if (other.plan_id === exceptPlan) return [];
      const plan = store.get<PlanRow>('batch_plans', other.plan_id);
      if (!plan) return [];
      return [
        `Une session d’un plan validé (période du ${frDate(plan.date_from)} au ${frDate(plan.date_to)}) est déjà prévue à ce créneau : rien n’est fusionné.`,
      ];
    });
  };

  const planDto = (plan: PlanRow): BatchPlanDto => {
    const current = new Map(
      live<{ id: string; date: string; moment_id: string; meal_id: string; servings: number }>(
        'plan',
      ).map((p) => [p.id, p]),
    );
    const meals = new Map(d.meals().map((m) => [m.id, m]));
    const preps = new Map(d.preps().map((p) => [p.id, p]));
    const changes = new Set<string>();
    const entryMeals = new Map<string, string>();
    const sessions = sessionsOf(plan.id).map((s): BatchSessionDto => {
      const byCook = new Map<string, PortionRow[]>();
      for (const p of portionsOf(s.id)) {
        entryMeals.set(p.plan_entry_id, p.meal_id);
        const k = p.prep_id ? `prep:${p.prep_id}` : `meal:${p.meal_id}`;
        byCook.set(k, [...(byCook.get(k) ?? []), p]);
        const now = current.get(p.plan_entry_id);
        if (!now) changes.add('un repas couvert a été retiré du planning');
        else if (now.date !== p.date || now.moment_id !== p.moment_id)
          changes.add('un repas couvert a été déplacé');
        else if (now.servings !== p.servings) changes.add('des portions ont changé');
        else if (now.meal_id !== p.meal_id) changes.add('un repas couvert a été remplacé');
        // v0.27: the recipes and preparations it was computed on.
        const recipe = meals.get(p.meal_id);
        if (!recipe) continue;
        const basis = p.basis ? (JSON.parse(p.basis) as Basis) : null;
        if (!p.prep_id) {
          if (recipe.split) changes.add('une recette couverte a été découpée en préparations');
          continue;
        }
        const lineQty = prepPortions(recipe.lines).get(p.prep_id);
        if (lineQty === undefined)
          changes.add('une préparation a été retirée d’une recette couverte');
        else if (basis && (basis.lineQty !== lineQty || basis.recipeServings !== recipe.servings))
          changes.add('la part d’une préparation dans une recette couverte a changé');
        const prep = preps.get(p.prep_id);
        if (basis && prep && compositionOf(prep) !== basis.composition)
          changes.add('la composition d’une préparation utilisée a changé');
      }
      const use = (p: PortionRow) => ({
        entryId: p.plan_entry_id,
        date: p.date,
        momentId: p.moment_id,
        // The portions of what is cooked (a v0.26 plan: the planned portions, the same thing).
        servings: p.basis ? (JSON.parse(p.basis) as Basis).portions : p.servings,
      });
      const byTime = (a: PortionRow, b: PortionRow) =>
        a.date.localeCompare(b.date) || order(a.moment_id) - order(b.moment_id);
      return {
        id: s.id,
        date: s.date,
        momentId: s.moment_id,
        beforePeriod: s.date < plan.date_from,
        startTime: s.start_time,
        durationMin: s.duration_min,
        cooks: [...byCook]
          .map(([, list]) =>
            cookDto(
              list[0]!.prep_id
                ? { prepId: list[0]!.prep_id, mealId: null }
                : { prepId: null, mealId: list[0]!.meal_id },
              list
                .filter((p) => !p.frozen)
                .sort(byTime)
                .map(use),
              list
                .filter((p) => p.frozen)
                .sort(byTime)
                .map(use),
              entryMeals,
            ),
          )
          .sort((a, b) => a.mealName.localeCompare(b.mealName, 'fr')),
        warnings: overlapWarnings({ date: s.date, momentId: s.moment_id }, plan.date_from, plan.id),
      };
    });
    const grid = JSON.parse(plan.grid) as BatchPlanDto['grid'];
    return {
      id: plan.id,
      createdAt: plan.created_at,
      freezer: plan.freezer === 1,
      daysBefore: plan.days_before,
      grid,
      sessions,
      changes: [...changes],
    };
  };

  // --- The calculation (read only) ----------------------------------------------------

  const compute = (body: Record<string, unknown>) => {
    const { from, to } = periodFrom(body);
    const daysBefore = daysBeforeFrom(body.daysBefore);
    const dates = gridDates(from, to, daysBefore);
    const slots = slotsFrom(body.slots, dates);
    if (!slots.length) throw new HttpError(400, 'Coche les créneaux où tu peux cuisiner.');
    const freezer = body.freezer === true;
    const wanted = new Set(Array.isArray(body.entryIds) ? body.entryIds.map(String) : []);
    const entries = d.planBetween(from, to).filter((p) => wanted.has(p.id));
    if (entries.length !== wanted.size)
      throw new HttpError(400, 'Un repas coché n’est plus dans le planning de la période.');
    const covered = coveredEntries();
    if (entries.some((e) => covered.has(e.id)))
      throw new HttpError(
        409,
        'Un repas coché est déjà couvert par un plan validé : annule d’abord ce plan.',
      );
    const meals = new Map(d.meals().map((m) => [m.id, m]));
    const missing: BatchProposalDto['missing'] = [];
    const entryMeals = new Map(entries.map((e) => [e.id, e.mealId]));
    // The couples (what is cooked, meal): the preparations of a split recipe, else the recipe.
    const batchMeals: BatchMeal[] = entries.flatMap((e) =>
      partsOf(meals.get(e.mealId), e.servings).flatMap((part) => {
        if (part.fridgeDays === null) {
          missing.push({ entryId: e.id, prepId: part.prepId, name: part.name });
          return [];
        }
        return [
          {
            entryId: e.id,
            date: e.date,
            momentId: e.momentId,
            recipeId: part.prepId ? `prep:${part.prepId}` : `meal:${part.mealId}`,
            recipeName: part.name,
            servings: part.portions,
            fridgeDays: part.fridgeDays,
            freezable: part.freezable,
            freezerDays: part.freezerDays,
          },
        ];
      }),
    );
    const result = planBatch({
      meals: batchMeals,
      slots,
      momentOrder: d.moments().map((m) => m.id),
      freezer,
    });
    const proposal: BatchProposalDto = {
      sessions: result.sessions.map((s) => ({
        date: s.date,
        momentId: s.momentId,
        beforePeriod: s.date < from,
        cooks: s.cooks.map((c) => cookDto(keyOf(c.recipeId), c.fridge, c.frozen, entryMeals)),
        warnings: overlapWarnings(s, from, null),
      })),
      uncovered: result.uncovered.map((u) => ({
        entryId: u.meal.entryId,
        prepId: keyOf(u.meal.recipeId).prepId,
        name: u.meal.recipeName,
        reason: u.reason,
      })),
      missing,
      covered: result.covered,
      total: result.total,
      tooComplex: result.tooComplex,
    };
    return { from, to, daysBefore, dates, slots, freezer, proposal, meals };
  };

  // --- Routes ---------------------------------------------------------------------------

  ctx.routes.get('/batch', (request): BatchStateDto => {
    const { from, to } = periodFrom(request.query as Record<string, unknown>);
    const daysBefore = settingDaysBefore();
    const moments = d.moments();
    const momentIds = moments.map((m) => m.id);
    const covered = coveredEntries();
    const meals = new Map(d.meals().map((m) => [m.id, m]));
    const saved = live<GridRow>('batch_grids', 'date_from = ? AND date_to = ?', from, to)[0];
    // Saved for this period: its dates as saved; dates shown now but not saved then: the model.
    const dates = gridDates(from, to, MAX_DAYS_BEFORE);
    let slots = projectModel(model(), dates, momentIds);
    if (saved) {
      const grid = JSON.parse(saved.slots) as { dates: string[]; slots: BatchSlotDto[] };
      const savedDates = new Set(grid.dates);
      slots = [
        ...grid.slots.filter((s) => momentIds.includes(s.momentId)),
        ...slots.filter((s) => !savedDates.has(s.date)),
      ];
    }
    return {
      from,
      to,
      moments,
      daysBefore,
      grid: { dates, slots, saved: Boolean(saved) },
      entries: d
        .planBetween(from, to)
        .sort((a, b) => a.date.localeCompare(b.date) || order(a.momentId) - order(b.momentId))
        .map((p) => {
          const m = meals.get(p.mealId);
          return {
            entryId: p.id,
            date: p.date,
            momentId: p.momentId,
            mealId: p.mealId,
            mealName: m?.name ?? 'Repas supprimé',
            servings: p.servings,
            batchTag: Boolean(m?.tags.some(isBatchTag)),
            fridgeDays: m?.fridgeDays ?? null,
            freezable: m?.freezable ?? false,
            freezerDays: m?.freezerDays ?? null,
            parts: partsOf(m, p.servings),
            coveredBy: covered.get(p.id) ?? null,
          } satisfies BatchEntryDto;
        }),
      plans: plansTouching(from, to).map(planDto),
    };
  });

  /** The grid of THIS period (the model is not touched). */
  ctx.routes.put('/batch/grid', (request) => {
    const body = requestBody(request);
    const { from, to } = periodFrom(body);
    const dates = gridDates(from, to, MAX_DAYS_BEFORE);
    const grid = JSON.stringify({ dates, slots: slotsFrom(body.slots, dates) });
    const saved = live<GridRow>('batch_grids', 'date_from = ? AND date_to = ?', from, to)[0];
    if (saved) store.update('batch_grids', saved.id, { slots: grid });
    else store.create('batch_grids', { date_from: from, date_to: to, slots: grid });
    return { ok: true };
  });
  /** « Retenir comme habituels »: the usual model from the grid of the period. */
  ctx.routes.post('/batch/grid/model', (request) => {
    const body = requestBody(request);
    const { from, to } = periodFrom(body);
    const momentIds = d.moments().map((m) => m.id);
    const next = modelFromSlots(slotsFrom(body.slots, gridDates(from, to, 0)), from, to, momentIds);
    ctx.settings.set('batchGridModel', JSON.stringify(next));
    return { model: next };
  });

  /** Proposes, writes nothing. */
  ctx.routes.post('/batch/compute', (request) => compute(requestBody(request)).proposal);

  /** « Valider ce plan »: the same calculation, then the plan is kept. */
  ctx.routes.post('/batch/plans', (request) => {
    const c = compute(requestBody(request));
    if (c.proposal.tooComplex || !c.proposal.sessions.length)
      throw new HttpError(400, 'Rien à valider : aucune session proposée.');
    const planned = new Map(d.planBetween(c.from, c.to).map((p) => [p.id, p]));
    const prepsNow = new Map(d.preps().map((p) => [p.id, p]));
    const plan = ctx.db.transaction(() => {
      const row = store.create<PlanRow>('batch_plans', {
        date_from: c.from,
        date_to: c.to,
        freezer: c.freezer ? 1 : 0,
        days_before: c.daysBefore,
        grid: JSON.stringify({ dates: c.dates, slots: c.slots }),
      });
      for (const s of c.proposal.sessions) {
        const session = store.create<SessionRow>('batch_sessions', {
          plan_id: row.id,
          date: s.date,
          moment_id: s.momentId,
          start_time: null,
          duration_min: null,
        });
        for (const cook of s.cooks)
          for (const [uses, frozen] of [
            [cook.fridge, 0],
            [cook.frozen, 1],
          ] as const)
            for (const u of uses) {
              const entry = planned.get(u.entryId)!;
              const recipe = c.meals.get(entry.mealId);
              const prep = cook.prepId ? prepsNow.get(cook.prepId) : undefined;
              const basis: Basis = prep
                ? {
                    portions: u.servings,
                    lineQty: prepPortions(recipe?.lines ?? []).get(prep.id),
                    recipeServings: recipe?.servings,
                    composition: compositionOf(prep),
                  }
                : { portions: u.servings };
              store.create('batch_portions', {
                session_id: session.id,
                plan_entry_id: u.entryId,
                meal_id: entry.mealId,
                date: u.date,
                moment_id: u.momentId,
                // The portions planned (as in v0.26: the banner compares them); the cooked ones in basis.
                servings: entry.servings,
                frozen,
                prep_id: cook.prepId,
                basis: JSON.stringify(basis),
              });
            }
      }
      return row;
    });
    ctx.logger.info(
      `Plan de batch cooking validé : ${c.proposal.sessions.length} session(s), du ${c.from} au ${c.to}`,
    );
    return planDto(plan);
  });

  /** Cancelled from the page after a confirmation: its meals become available again. */
  ctx.routes.delete('/batch/plans/:id', (request) => {
    const id = (request.params as { id: string }).id;
    if (!store.get('batch_plans', id)) throw new HttpError(404, 'Plan introuvable');
    ctx.db.transaction(() => {
      for (const s of sessionsOf(id)) {
        for (const p of portionsOf(s.id)) store.remove('batch_portions', p.id);
        store.remove('batch_sessions', s.id);
      }
      store.remove('batch_plans', id);
    });
    return { ok: true };
  });

  /** Time and length of a validated session (both optional, empty by default). */
  ctx.routes.patch('/batch/sessions/:id', (request) => {
    const id = (request.params as { id: string }).id;
    if (!store.get('batch_sessions', id)) throw new HttpError(404, 'Session introuvable');
    const body = requestBody(request);
    const fields: Record<string, string | number | null> = {};
    if ('startTime' in body) {
      const t = String(body.startTime ?? '');
      if (t && !TIME.test(t)) throw new HttpError(400, 'Heure invalide (HH:MM)');
      fields.start_time = t || null;
    }
    if ('durationMin' in body) {
      const v = body.durationMin;
      const n = v === null || v === '' || v === undefined ? null : Number(v);
      if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 1440))
        throw new HttpError(400, 'Durée : de 1 à 1440 minutes, ou vide');
      fields.duration_min = n;
    }
    if (Object.keys(fields).length) store.update('batch_sessions', id, fields);
    return { ok: true };
  });

  return {
    /** « Sortir du congélateur » the evening before each frozen portion, days from..to. */
    thaw(from: string, to: string): ThawDto[] {
      const names = new Map(d.meals().map((m) => [m.id, m.name]));
      const prepNames = new Map(d.preps().map((p) => [p.id, p.name]));
      const byDay = new Map<string, Set<string>>();
      for (const p of live<PortionRow>(
        'batch_portions',
        // The reminder is the evening before: portions eaten from..to + 1 day.
        'frozen = 1 AND date >= ? AND date <= ?',
        addDaysTo(from, 1),
        addDaysTo(to, 1),
      ).filter((p) => {
        const session = store.get<SessionRow>('batch_sessions', p.session_id);
        return session !== null && store.get('batch_plans', session.plan_id) !== null;
      })) {
        const day = addDaysTo(p.date, -1);
        const name = p.prep_id
          ? (prepNames.get(p.prep_id) ?? 'Préparation')
          : (names.get(p.meal_id) ?? 'Repas');
        byDay.set(day, (byDay.get(day) ?? new Set()).add(name));
      }
      // One line per day, what to take out (never the detail per meal).
      return [...byDay]
        .map(([date, set]) => ({
          date,
          names: [...set].sort((a, b) => a.localeCompare(b, 'fr')),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    /** The sessions of the validated plans, for the general calendar. */
    calendarEvents(from: string, to: string): CalendarEvent[] {
      return live<SessionRow>('batch_sessions', 'date >= ? AND date <= ?', from, to)
        .filter((s) => store.get('batch_plans', s.plan_id) !== null)
        .map((s) => {
          const meals = d.meals();
          const preps = d.preps();
          const names = [
            ...new Set(
              portionsOf(s.id).map((p) =>
                p.prep_id
                  ? preps.find((x) => x.id === p.prep_id)?.name
                  : meals.find((m) => m.id === p.meal_id)?.name,
              ),
            ),
          ].filter(Boolean);
          return {
            id: `batch:${s.id}`,
            title: `Batch cooking : ${names.join(', ') || 'session'}`,
            start: s.start_time ? `${s.date}T${s.start_time}` : s.date,
            durationMin: s.duration_min ?? 0,
            open: '/m/courses?tab=batch',
            status: 'plan validé',
          };
        });
    },
  };
}
