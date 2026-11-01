// The filters of the recipes (search, sort, maximum cost, keeping, tags): one
// component for the « Repas » tab and the meal picker of the planning, with
// the same logic (shared/meal-filter.ts).
import type { ReactNode } from 'react';
import type { KeepFilter, MealFilter, MealSort } from '../shared/meal-filter';

export function MealFilters(props: {
  filter: MealFilter;
  onChange: (filter: MealFilter) => void;
  /** Tags of the recipes, sorted. */
  tags: string[];
  /** The search field takes the keyboard when shown (meal picker). */
  autoFocus?: boolean;
  /** More controls at the end of the first row (view, « Nouveau repas »). */
  children?: ReactNode;
}) {
  const { filter } = props;
  const set = (change: Partial<MealFilter>) => props.onChange({ ...filter, ...change });
  return (
    <div className="cs-filters">
      <div className="cs-row">
        <input
          autoFocus={props.autoFocus}
          className="input cs-grow"
          type="search"
          value={filter.q}
          placeholder="Rechercher un repas ou un ingrédient"
          aria-label="Rechercher"
          onChange={(e) => set({ q: e.target.value })}
        />
        <select
          className="input"
          value={filter.sort}
          aria-label="Trier"
          onChange={(e) => set({ sort: e.target.value as MealSort })}
        >
          <option value="name">Trier par nom</option>
          <option value="cost">Moins chers d’abord</option>
          <option value="protein">Plus protéinés d’abord</option>
        </select>
        <select
          className="input"
          value={filter.keep}
          aria-label="Conservation"
          onChange={(e) => set({ keep: e.target.value as KeepFilter })}
        >
          <option value="all">Toute conservation</option>
          <option value="known">Conservation renseignée</option>
          <option value="missing">Conservation manquante</option>
          <option value="freezable">Congelables</option>
        </select>
        <label className="small">
          Max{' '}
          <input
            className="input input--tiny num"
            value={filter.maxCost}
            placeholder="€"
            aria-label="Coût maximal par portion"
            onChange={(e) => set({ maxCost: e.target.value })}
          />{' '}
          € / portion
        </label>
        {props.children}
      </div>
      {props.tags.length > 0 && (
        <div className="cs-row" role="group" aria-label="Tags">
          {props.tags.map((t) => (
            <button
              key={t}
              type="button"
              className={`cs-chip${filter.tag === t ? ' cs-chip--on' : ''}`}
              aria-pressed={filter.tag === t}
              onClick={() => set({ tag: filter.tag === t ? null : t })}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
