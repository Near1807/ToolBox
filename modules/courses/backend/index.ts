// Courses: the shopping list made from MEALS. A catalogue of ingredients
// (unit, aisle; merged when two are the same), a library of meals (portions,
// ingredient lines, tags, note), the meals planned per day and moment for a
// period, and the list generated for that period (quantities added up and
// converted, scaled to the portions, by aisle) plus the extras; ticked while
// shopping. « Prêt pour la synchro » and « Prêt pour le calendrier ».
// The assistant reads freely and changes only with its own right (off).
import {
  changesTableSql,
  defineBackendModule,
  HttpError,
  listPhrase,
  matchByName,
  type ModuleContext,
  requestBody,
  SYNC_COLUMNS,
  SyncStore,
} from '@hub/sdk/backend';
import { addDays, localToday, mondayOf, weekdayOf } from '../shared/dates';
import { addUp, fold, formatAmount, plannedLines, type MealRecipe } from '../shared/quantities';
import type {
  IngredientDto,
  ListDto,
  MealDto,
  MomentDto,
  PlanDto,
  StateDto,
} from '../shared/types';
import {
  extractAddExtra,
  extractPlanMeal,
  extractWhatToEat,
  EXTRA_EXAMPLES,
  LIST_EXAMPLES,
  PLAN_EXAMPLES,
  WHAT_EXAMPLES,
} from './commands';

interface Base {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
interface IngredientRow extends Base {
  name: string;
  unit: string;
  aisle: string;
}
interface MealRow extends Base {
  name: string;
  servings: number;
  tags: string;
  note: string;
}
interface ItemRow extends Base {
  meal_id: string;
  ingredient_id: string;
  qty: number;
  unit: string;
}
interface MomentRow extends Base {
  name: string;
  default_time: string;
  duration_min: number;
  position: number;
}
interface PlanRow extends Base {
  date: string;
  moment_id: string;
  meal_id: string;
  servings: number;
}
interface ExtraRow extends Base {
  name: string;
  aisle: string;
}
interface ListRow extends Base {
  date_from: string;
  date_to: string;
}
interface ListExtraRow extends Base {
  list_id: string;
  name: string;
  qty: string;
  aisle: string;
  checked: number;
}
interface CheckRow extends Base {
  list_id: string;
  item_key: string;
  checked: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const NO_AISLE = 'Sans rayon';
const DEFAULT_MOMENTS = [
  { name: 'Matin', default_time: '08:00', duration_min: 20 },
  { name: 'Midi', default_time: '12:30', duration_min: 45 },
  { name: 'Collation', default_time: '16:30', duration_min: 15 },
  { name: 'Soir', default_time: '19:30', duration_min: 45 },
];

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'ingredients, meals, moments, planning, extras, shopping list, journal',
      up: `
        CREATE TABLE courses__ingredients (${SYNC_COLUMNS}, name TEXT NOT NULL, unit TEXT NOT NULL, aisle TEXT NOT NULL DEFAULT '');
        CREATE TABLE courses__meals (${SYNC_COLUMNS}, name TEXT NOT NULL, servings INTEGER NOT NULL, tags TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '');
        CREATE TABLE courses__meal_items (${SYNC_COLUMNS}, meal_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, qty REAL NOT NULL, unit TEXT NOT NULL);
        CREATE INDEX courses__meal_items_meal ON courses__meal_items (meal_id);
        CREATE TABLE courses__moments (${SYNC_COLUMNS}, name TEXT NOT NULL, default_time TEXT NOT NULL, duration_min INTEGER NOT NULL, position INTEGER NOT NULL);
        CREATE TABLE courses__plan (${SYNC_COLUMNS}, date TEXT NOT NULL, moment_id TEXT NOT NULL, meal_id TEXT NOT NULL, servings REAL NOT NULL);
        CREATE INDEX courses__plan_date ON courses__plan (date);
        CREATE TABLE courses__extras (${SYNC_COLUMNS}, name TEXT NOT NULL, aisle TEXT NOT NULL DEFAULT '');
        CREATE TABLE courses__lists (${SYNC_COLUMNS}, date_from TEXT NOT NULL, date_to TEXT NOT NULL);
        CREATE TABLE courses__list_extras (${SYNC_COLUMNS}, list_id TEXT NOT NULL, name TEXT NOT NULL, qty TEXT NOT NULL DEFAULT '', aisle TEXT NOT NULL DEFAULT '', checked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE courses__list_checks (${SYNC_COLUMNS}, list_id TEXT NOT NULL, item_key TEXT NOT NULL, checked INTEGER NOT NULL);
        ${changesTableSql('courses__changes')}
      `,
    },
  ],

  register(ctx: ModuleContext) {
    const store = new SyncStore(ctx.db);
    const T = (name: string) => ctx.db.table(name);
    const live = <R>(table: string, where = '', ...args: unknown[]) =>
      ctx.db
        .prepare(
          `SELECT * FROM ${T(table)} WHERE deleted_at IS NULL${where ? ` AND ${where}` : ''}`,
        )
        .all(...args) as R[];
    const today = () => localToday();

    // Moments: four by default, the first time.
    if (live<MomentRow>('moments').length === 0)
      DEFAULT_MOMENTS.forEach((m, position) => store.create('moments', { ...m, position }));

    // --- Reading -------------------------------------------------------------------

    const ingredients = (): IngredientDto[] =>
      live<IngredientRow>('ingredients')
        .map((r) => ({ id: r.id, name: r.name, unit: r.unit, aisle: r.aisle }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const moments = (): MomentDto[] =>
      live<MomentRow>('moments')
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          id: r.id,
          name: r.name,
          time: r.default_time,
          durationMin: r.duration_min,
        }));
    const meals = (): MealDto[] => {
      const items = live<ItemRow>('meal_items');
      return live<MealRow>('meals')
        .map((r) => ({
          id: r.id,
          name: r.name,
          servings: r.servings,
          tags: JSON.parse(r.tags) as string[],
          note: r.note,
          items: items
            .filter((i) => i.meal_id === r.id)
            .map((i) => ({ id: i.id, ingredientId: i.ingredient_id, qty: i.qty, unit: i.unit })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    };
    const planBetween = (from: string, to: string): PlanDto[] =>
      live<PlanRow>('plan', 'date BETWEEN ? AND ?', from, to)
        .map((r) => ({
          id: r.id,
          date: r.date,
          momentId: r.moment_id,
          mealId: r.meal_id,
          servings: r.servings,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    const currentList = (): ListRow => {
      const lists = live<ListRow>('lists').sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (lists[0]) return lists[0];
      const monday = mondayOf(today());
      return store.create<ListRow>('lists', { date_from: monday, date_to: addDays(monday, 6) });
    };

    const listDto = (): ListDto => {
      const list = currentList();
      const ing = new Map(ingredients().map((i) => [i.id, i]));
      const recipes = new Map<string, MealRecipe>(meals().map((m) => [m.id, m]));
      const plan = planBetween(list.date_from, list.date_to);
      const checks = new Map(
        live<CheckRow>('list_checks', 'list_id = ?', list.id).map((c) => [
          c.item_key,
          c.checked === 1,
        ]),
      );
      const totals = addUp(plannedLines(plan, recipes));
      const generated = totals
        .map((t) => {
          const i = ing.get(t.ingredientId);
          return {
            key: `ing:${t.ingredientId}`,
            name: i?.name ?? 'Ingrédient supprimé',
            amount: t.amounts.map(formatAmount).join(' + '),
            aisle: i?.aisle || NO_AISLE,
            checked: checks.get(`ing:${t.ingredientId}`) ?? false,
            source: 'meals' as const,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      const extras = live<ListExtraRow>('list_extras', 'list_id = ?', list.id).map((e) => ({
        key: `extra:${e.id}`,
        id: e.id,
        name: e.name,
        amount: e.qty,
        aisle: e.aisle || NO_AISLE,
        checked: e.checked === 1,
        source: 'extra' as const,
      }));
      const all = [...generated, ...extras];
      const aisles = [...new Set(all.map((x) => x.aisle))].sort((a, b) =>
        a === NO_AISLE ? 1 : b === NO_AISLE ? -1 : a.localeCompare(b, 'fr'),
      );
      return {
        id: list.id,
        from: list.date_from,
        to: list.date_to,
        mealsPlanned: plan.length,
        groups: aisles.map((aisle) => ({ aisle, items: all.filter((x) => x.aisle === aisle) })),
        habitual: live<ExtraRow>('extras')
          .map((e) => ({ id: e.id, name: e.name, aisle: e.aisle }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
      };
    };
    const listText = (dto = listDto()) =>
      `Courses du ${dto.from} au ${dto.to}\n${dto.groups
        .map(
          (g) =>
            `\n## ${g.aisle}\n${g.items.map((i) => `- [${i.checked ? 'x' : ' '}] ${i.name}${i.amount ? ` — ${i.amount}` : ''}`).join('\n')}`,
        )
        .join('\n')}\n`;

    const state = (): StateDto => {
      const list = currentList();
      return {
        today: today(),
        ingredients: ingredients(),
        meals: meals(),
        moments: moments(),
        plan: planBetween(list.date_from, list.date_to),
        list: listDto(),
      };
    };

    // --- Checks of the fields ------------------------------------------------------

    const text = (value: unknown, label: string, max = 80) => {
      const v = String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, max);
      if (!v) throw new HttpError(400, `${label} vide`);
      return v;
    };
    const ingredientByName = (name: string) =>
      live<IngredientRow>('ingredients').find((i) => fold(i.name) === fold(name));
    const mealOf = (id: string) => {
      const m = store.get<MealRow>('meals', id);
      if (!m) throw new HttpError(404, 'Repas introuvable');
      return m;
    };

    /** The lines of a meal: an unknown ingredient name is created (after the user saw « nouvel ingrédient »). */
    const saveItems = (mealId: string, raw: unknown) => {
      if (!Array.isArray(raw)) throw new HttpError(400, 'Ingrédients invalides');
      for (const old of live<ItemRow>('meal_items', 'meal_id = ?', mealId))
        store.remove('meal_items', old.id);
      for (const r of raw as Record<string, unknown>[]) {
        const qty = Number(r.qty);
        if (!(qty > 0)) throw new HttpError(400, 'Quantité invalide');
        const unit = text(r.unit, 'Unité', 20);
        let ingredientId = typeof r.ingredientId === 'string' ? r.ingredientId : '';
        if (!ingredientId || !store.get('ingredients', ingredientId)) {
          const name = text(r.name, 'Ingrédient');
          ingredientId =
            ingredientByName(name)?.id ?? store.create('ingredients', { name, unit, aisle: '' }).id;
        }
        store.create('meal_items', { meal_id: mealId, ingredient_id: ingredientId, qty, unit });
      }
    };
    const mealFields = (body: Record<string, unknown>) => {
      const servings = Number(body.servings ?? 1);
      if (!(Number.isInteger(servings) && servings >= 1 && servings <= 50))
        throw new HttpError(400, 'Portions de 1 à 50');
      const tags = Array.isArray(body.tags)
        ? [
            ...new Set(
              (body.tags as unknown[])
                .map((t) => String(t).trim().replace(/^#/, ''))
                .filter(Boolean),
            ),
          ]
        : [];
      return {
        name: text(body.name, 'Nom du repas'),
        servings,
        tags: JSON.stringify(tags),
        note: String(body.note ?? '').slice(0, 2000),
      };
    };

    const addPlan = (date: string, momentId: string, mealId: string, servings: number) => {
      if (!DAY.test(date)) throw new HttpError(400, 'Jour invalide');
      if (!store.get('moments', momentId)) throw new HttpError(400, 'Moment inconnu');
      mealOf(mealId);
      if (!(servings > 0 && servings <= 50)) throw new HttpError(400, 'Portions de 0,5 à 50');
      return store.create<PlanRow>('plan', {
        date,
        moment_id: momentId,
        meal_id: mealId,
        servings,
      });
    };
    const addListExtra = (name: string, qty = '', aisle = '') =>
      store.create<ListExtraRow>('list_extras', {
        list_id: currentList().id,
        name,
        qty,
        aisle,
        checked: 0,
      });

    // --- Routes ----------------------------------------------------------------------

    ctx.routes.get('/state', () => state());

    ctx.routes.post('/ingredients', (request) => {
      const body = requestBody(request);
      const name = text(body.name, 'Nom de l’ingrédient');
      const existing = ingredientByName(name);
      if (existing) throw new HttpError(409, `« ${existing.name} » existe déjà`);
      return store.create('ingredients', {
        name,
        unit: text(body.unit ?? 'g', 'Unité', 20),
        aisle: String(body.aisle ?? '')
          .trim()
          .slice(0, 40),
      });
    });
    ctx.routes.patch('/ingredients/:id', (request) => {
      const id = (request.params as { id: string }).id;
      if (!store.get('ingredients', id)) throw new HttpError(404, 'Ingrédient introuvable');
      const body = requestBody(request);
      const fields: Record<string, string> = {};
      if ('name' in body) {
        const name = text(body.name, 'Nom');
        const other = ingredientByName(name);
        if (other && other.id !== id)
          throw new HttpError(409, `« ${other.name} » existe déjà : fusionne-les plutôt`);
        fields.name = name;
      }
      if ('unit' in body) fields.unit = text(body.unit, 'Unité', 20);
      if ('aisle' in body)
        fields.aisle = String(body.aisle ?? '')
          .trim()
          .slice(0, 40);
      return store.update('ingredients', id, fields);
    });
    /** Two ingredients that are the same: the lines of `from` go to `into`, `from` is removed (tombstone). */
    ctx.routes.post('/ingredients/merge', (request) => {
      const body = requestBody(request);
      const from = String(body.from ?? '');
      const into = String(body.into ?? '');
      if (from === into || !store.get('ingredients', from) || !store.get('ingredients', into))
        throw new HttpError(400, 'Choisis deux ingrédients différents');
      ctx.db.transaction(() => {
        for (const item of live<ItemRow>('meal_items', 'ingredient_id = ?', from))
          store.update('meal_items', item.id, { ingredient_id: into });
        store.remove('ingredients', from);
      });
      return { ok: true };
    });

    ctx.routes.post('/meals', (request) => {
      const body = requestBody(request);
      const meal = store.create<MealRow>('meals', mealFields(body));
      saveItems(meal.id, body.items ?? []);
      return { id: meal.id };
    });
    ctx.routes.put('/meals/:id', (request) => {
      const id = (request.params as { id: string }).id;
      mealOf(id);
      const body = requestBody(request);
      ctx.db.transaction(() => {
        store.update('meals', id, mealFields(body));
        saveItems(id, body.items ?? []);
      });
      return { id };
    });
    // Confirmed on the page; « Annuler » restores it (tombstone).
    ctx.routes.delete('/meals/:id', (request) => {
      const id = (request.params as { id: string }).id;
      mealOf(id);
      store.remove('meals', id);
      return { ok: true };
    });
    ctx.routes.post('/meals/:id/restore', (request) => {
      store.restore('meals', (request.params as { id: string }).id);
      return { ok: true };
    });

    ctx.routes.put('/moments', (request) => {
      const list = requestBody(request).moments;
      if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'Au moins un moment');
      const before = new Map(moments().map((m) => [m.id, m]));
      const keep = new Set<string>();
      ctx.db.transaction(() => {
        (list as Record<string, unknown>[]).forEach((m, position) => {
          if (!TIME.test(String(m.time))) throw new HttpError(400, 'Heure invalide (HH:MM)');
          const duration = Number(m.durationMin ?? 30);
          const fields = {
            name: text(m.name, 'Moment', 30),
            default_time: String(m.time),
            duration_min: duration,
            position,
          };
          const id = typeof m.id === 'string' && before.has(m.id) ? m.id : null;
          if (id) {
            keep.add(id);
            store.update('moments', id, fields);
          } else keep.add(store.create('moments', fields).id);
        });
        // A moment still used by the planning stays (renamed if needed, never lost).
        for (const id of before.keys())
          if (!keep.has(id)) {
            if (live<PlanRow>('plan', 'moment_id = ?', id).length)
              throw new HttpError(
                409,
                `« ${before.get(id)!.name} » a des repas planifiés : retire-les d’abord`,
              );
            store.remove('moments', id);
          }
      });
      return { moments: moments() };
    });

    ctx.routes.post('/plan', (request) => {
      const b = requestBody(request);
      return addPlan(String(b.date), String(b.momentId), String(b.mealId), Number(b.servings ?? 1));
    });
    ctx.routes.patch('/plan/:id', (request) => {
      const id = (request.params as { id: string }).id;
      if (!store.get('plan', id)) throw new HttpError(404, 'Repas planifié introuvable');
      const servings = Number(requestBody(request).servings);
      if (!(servings > 0 && servings <= 50)) throw new HttpError(400, 'Portions de 0,5 à 50');
      return store.update('plan', id, { servings });
    });
    ctx.routes.delete('/plan/:id', (request) => {
      store.remove('plan', (request.params as { id: string }).id);
      return { ok: true };
    });

    /** The period of the list (and of the planning shown). */
    ctx.routes.put('/list', (request) => {
      const b = requestBody(request);
      const from = String(b.from);
      const to = String(b.to);
      if (!DAY.test(from) || !DAY.test(to) || from > to)
        throw new HttpError(400, 'Période invalide');
      if (addDays(from, 62) < to) throw new HttpError(400, 'Deux mois au plus');
      const list = currentList();
      store.update('lists', list.id, { date_from: from, date_to: to });
      return listDto();
    });
    ctx.routes.post('/list/check', (request) => {
      const b = requestBody(request);
      const key = String(b.key ?? '');
      const checked = b.checked === true ? 1 : 0;
      const list = currentList();
      if (key.startsWith('extra:')) store.update('list_extras', key.slice(6), { checked });
      else {
        const existing = live<CheckRow>(
          'list_checks',
          'list_id = ? AND item_key = ?',
          list.id,
          key,
        )[0];
        if (existing) store.update('list_checks', existing.id, { checked });
        else store.create('list_checks', { list_id: list.id, item_key: key, checked });
      }
      return listDto();
    });
    /** A new list for the same period: every tick cleared (the old ticks stay in the journal). */
    ctx.routes.post('/list/uncheck-all', () => {
      const list = currentList();
      for (const c of live<CheckRow>('list_checks', 'list_id = ?', list.id))
        store.update('list_checks', c.id, { checked: 0 });
      for (const e of live<ListExtraRow>('list_extras', 'list_id = ?', list.id))
        store.update('list_extras', e.id, { checked: 0 });
      return listDto();
    });
    ctx.routes.post('/list/extras', (request) => {
      const b = requestBody(request);
      addListExtra(
        text(b.name, 'Article'),
        String(b.qty ?? '').slice(0, 30),
        String(b.aisle ?? '').slice(0, 40),
      );
      return listDto();
    });
    ctx.routes.delete('/list/extras/:id', (request) => {
      store.remove('list_extras', (request.params as { id: string }).id);
      return listDto();
    });
    ctx.routes.post('/extras', (request) => {
      const b = requestBody(request);
      const name = text(b.name, 'Extra');
      if (live<ExtraRow>('extras').some((e) => fold(e.name) === fold(name)))
        throw new HttpError(409, `« ${name} » est déjà dans tes extras habituels`);
      store.create('extras', { name, aisle: String(b.aisle ?? '').slice(0, 40) });
      return listDto();
    });
    ctx.routes.delete('/extras/:id', (request) => {
      store.remove('extras', (request.params as { id: string }).id);
      return listDto();
    });
    ctx.routes.get('/list/text', () => ({ text: listText() }));
    ctx.routes.post('/list/export', async () => {
      const dto = listDto();
      const saved = await ctx.files.saveAs({
        title: 'Exporter la liste de courses',
        defaultName: `Courses ${dto.from} - ${dto.to}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        data: listText(dto),
      });
      return saved ? { path: saved } : { cancelled: true };
    });
    ctx.routes.get('/home', () => {
      const m = moments();
      const plan = planBetween(today(), today());
      const names = new Map(meals().map((x) => [x.id, x.name]));
      return {
        today: today(),
        meals: m.flatMap((moment) =>
          plan
            .filter((p) => p.momentId === moment.id)
            .map((p) => ({
              moment: moment.name,
              name: names.get(p.mealId) ?? '?',
              servings: p.servings,
            })),
        ),
      };
    });

    // --- « Prêt pour le calendrier » (MODULES.md §5.17), read only -------------------

    ctx.calendar.provide({
      events: (from, to) => {
        const m = new Map(moments().map((x) => [x.id, x]));
        const names = new Map(meals().map((x) => [x.id, x.name]));
        return planBetween(from, to).map((p) => {
          const moment = m.get(p.momentId);
          return {
            id: p.id,
            title: `${moment?.name ?? 'Repas'} : ${names.get(p.mealId) ?? 'repas'}`,
            start: `${p.date}T${moment?.time ?? '12:00'}`,
            durationMin: moment?.durationMin ?? 30,
            open: `/m/courses?date=${p.date}`,
            status: `${String(p.servings).replace('.', ',')} portion${p.servings > 1 ? 's' : ''}`,
          };
        });
      },
    });

    // --- Assistant (MODULES.md §5.15) ------------------------------------------------

    const right = {
      id: 'edit-meals',
      label: 'L’assistant peut modifier les repas et la liste de courses',
    };
    const momentNamed = (name: string) => {
      const m = moments().find(
        (x) => fold(x.name) === fold(name) || fold(x.name).startsWith(fold(name)),
      );
      if (!m)
        throw new HttpError(
          404,
          `Pas de moment « ${name} » (${listPhrase(moments().map((x) => x.name.toLowerCase()))}).`,
        );
      return m;
    };
    /** « mardi » → the next Tuesday from today (today included); « demain », « aujourd'hui ». */
    const dayFrom = (value: unknown): string => {
      const v = String(value ?? 'today');
      if (v === 'today') return today();
      if (v === 'tomorrow') return addDays(today(), 1);
      const weekday = Number(v);
      const diff = (weekday - weekdayOf(today()) + 7) % 7;
      return addDays(today(), diff);
    };

    ctx.assistant.define({
      name: 'what-to-eat',
      examples: WHAT_EXAMPLES,
      extract: extractWhatToEat,
      description: 'Dit les repas planifiés pour un jour et un moment (ce soir, demain midi…).',
      parameters: {
        day: { type: 'string', description: '« today », « tomorrow » ou 1 (lundi) … 7 (dimanche)' },
        moment: { type: 'string', description: 'Moment, ex. « soir ». Absent : toute la journée.' },
      },
      risk: 'read',
      run: (params) => {
        const date = dayFrom(params.day);
        const names = new Map(meals().map((x) => [x.id, x.name]));
        const m = params.moment ? [momentNamed(String(params.moment))] : moments();
        const plan = planBetween(date, date).filter((p) => m.some((x) => x.id === p.momentId));
        const when = `${params.day === 'tomorrow' ? 'demain' : date === today() ? 'aujourd’hui' : `le ${date}`}${params.moment ? ` ${m[0]!.name.toLowerCase()}` : ''}`;
        return {
          message: plan.length
            ? `${when[0]!.toUpperCase()}${when.slice(1)} : ${listPhrase(plan.map((p) => `${names.get(p.mealId) ?? '?'}${p.servings !== 1 ? ` (${String(p.servings).replace('.', ',')} portions)` : ''}`))}.`
            : `Rien de prévu ${when}.`,
          data: { date, plan },
        };
      },
    });
    ctx.assistant.define({
      name: 'shopping-list',
      examples: LIST_EXAMPLES,
      extract: () => ({}),
      description: 'Résume la liste de courses en cours (articles restants, par rayon).',
      risk: 'read',
      run: () => {
        const dto = listDto();
        const left = dto.groups.flatMap((g) => g.items).filter((i) => !i.checked);
        return {
          message: left.length
            ? `${left.length} article${left.length > 1 ? 's' : ''} à acheter : ${listPhrase(left.slice(0, 8).map((i) => i.name))}${left.length > 8 ? ', etc.' : ''}.`
            : 'La liste de courses est vide (ou tout est coché).',
          data: { groups: dto.groups },
          open: '/m/courses?tab=list',
        };
      },
    });
    ctx.assistant.define({
      name: 'add-extra',
      examples: EXTRA_EXAMPLES,
      extract: extractAddExtra,
      right,
      description: 'Ajoute un article hors repas (extra) à la liste de courses.',
      parameters: { name: { type: 'string', description: 'L’article, ex. « café »' } },
      required: ['name'],
      risk: 'change',
      run: (params) => {
        const name = text(params.name, 'Article');
        const habitual = live<ExtraRow>('extras').find((e) => fold(e.name) === fold(name));
        const row = addListExtra(habitual?.name ?? name, '', habitual?.aisle ?? '');
        return {
          message: `« ${row.name} » ajouté aux courses.`,
          data: { id: row.id },
          undo: () => store.remove('list_extras', row.id),
        };
      },
    });
    ctx.assistant.define({
      name: 'plan-meal',
      examples: PLAN_EXAMPLES,
      extract: extractPlanMeal,
      right,
      description:
        'Planifie un repas de la bibliothèque un jour à un moment (« mets risotto mardi soir »).',
      parameters: {
        meal: { type: 'string', description: 'Nom du repas, ex. « risotto »' },
        day: { type: 'string', description: '« today », « tomorrow » ou 1 (lundi) … 7 (dimanche)' },
        moment: { type: 'string', description: 'Moment, ex. « soir »' },
        servings: { type: 'number', description: 'Portions (1 par défaut)' },
      },
      required: ['meal', 'day', 'moment'],
      risk: 'change',
      run: (params) => {
        const match = matchByName(meals(), String(params.meal), (m) => m.name);
        if (match.kind === 'none')
          throw new HttpError(404, `Pas de repas « ${String(params.meal)} » dans la bibliothèque.`);
        if (match.kind === 'ambiguous')
          throw new HttpError(
            409,
            `Plusieurs repas : ${listPhrase(match.items.slice(0, 4).map((m) => m.name))}. Lequel ?`,
          );
        const moment = momentNamed(String(params.moment));
        const date = dayFrom(params.day);
        const row = addPlan(date, moment.id, match.item.id, Number(params.servings ?? 1));
        return {
          message: `${match.item.name} planifié le ${date} au ${moment.name.toLowerCase()}.`,
          data: { id: row.id },
          undo: () => store.remove('plan', row.id),
        };
      },
    });
  },
});
