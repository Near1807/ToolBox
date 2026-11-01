// Choosing a meal for a slot of the planning (« Lundi · Goûter »): the same
// search and filters as the « Repas » tab, a list that scrolls whatever its
// length, the portions (1 by default), and the keyboard: arrows, Entrée to
// choose, Échap to close. No picture here: the planning stays compact.
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@hub/sdk/frontend';
import { filterMeals, NO_FILTER, type MealFilter } from '../shared/meal-filter';
import type { MealDto, StateDto } from '../shared/types';
import { MealFilters } from './MealFilters';

export function MealPicker(props: {
  state: StateDto;
  /** « Lundi 26 oct. · Goûter ». */
  slotLabel: string;
  onChoose: (mealId: string, servings: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<MealFilter>(NO_FILTER);
  const [active, setActive] = useState(0);
  const [servings, setServings] = useState('1');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const names = useMemo(
    () => new Map(props.state.ingredients.map((i) => [i.id, i.name])),
    [props.state.ingredients],
  );
  const tags = useMemo(
    () => [...new Set(props.state.meals.flatMap((m) => m.tags))].sort(),
    [props.state.meals],
  );
  const shown = filterMeals(props.state.meals, names, filter);
  const index = Math.min(active, Math.max(0, shown.length - 1));
  const portions = Number(servings.replace(',', '.'));
  const validPortions = portions > 0 && portions <= 50;

  // The active line stays visible while moving with the arrows.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (meal: MealDto | undefined) => {
    if (!meal || !validPortions || busy) return;
    setBusy(true);
    void props.onChoose(meal.id, portions).then((ok) => {
      setBusy(false);
      if (ok) props.onClose();
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.max(0, Math.min(shown.length - 1, index + step)));
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      choose(shown[index]);
    }
  };

  return (
    <div
      className="cs-picker-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        className="cs-picker"
        role="dialog"
        aria-modal="true"
        aria-label={`Ajouter un repas : ${props.slotLabel}`}
        onKeyDown={onKeyDown}
      >
        <div className="cs-picker__head">
          <h2>{props.slotLabel}</h2>
          <label className="small">
            Portions{' '}
            <input
              className="input input--tiny num"
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={servings}
              aria-label="Portions"
              onChange={(e) => setServings(e.target.value)}
            />
          </label>
          <Button variant="secondary" small onClick={props.onClose}>
            Fermer
          </Button>
        </div>
        <MealFilters
          filter={filter}
          onChange={(f) => {
            setFilter(f);
            setActive(0);
          }}
          tags={tags}
          autoFocus
        />
        {shown.length === 0 ? (
          <p className="muted cs-picker__empty">
            {props.state.meals.length
              ? 'Aucun repas ne correspond.'
              : 'Aucun repas pour l’instant.'}
          </p>
        ) : (
          <ul
            ref={list}
            className="cs-picker__list"
            role="listbox"
            aria-label="Repas"
            aria-activedescendant={`cs-pick-${index}`}
          >
            {shown.map((m, i) => (
              <li
                key={m.id}
                id={`cs-pick-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === index}
                className={`cs-picker__item${i === index ? ' cs-picker__item--active' : ''}`}
                onMouseMove={() => i !== index && setActive(i)}
                onClick={() => choose(m)}
              >
                <strong>{m.name}</strong>
                <span className="small muted">
                  {m.tags.length ? ` ${m.tags.map((t) => `#${t}`).join(' ')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          ↑ ↓ pour choisir, Entrée pour ajouter{validPortions ? '' : ' (portions : de 0,5 à 50)'},
          Échap pour fermer.
        </p>
      </div>
    </div>
  );
}
