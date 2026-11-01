// What the recipe editor and the preparation editor share (v0.27): the
// ingredient line (Suggest, quantity, unit, « nouvel ingrédient »), the
// keeping fieldset, the quantities shown (rounded on screen only, never in
// storage).
import { Icon } from '@hub/sdk/frontend';
import { fold, UNITS } from '../shared/quantities';
import { product } from '../shared/recipe';
import type { IngredientDto, PrepDto } from '../shared/types';
import { Suggest } from './Suggest';

export interface IngredientEditLine {
  kind: 'ingredient';
  /** Line id when saved (selection for « Extraire en préparation »), else a local key. */
  key: string;
  ingredientId: string;
  name: string;
  qty: string;
  unit: string;
  /** The stored quantity: sent back as it is while the field shows it unchanged (never rounded). */
  exact?: number;
}
export interface PrepEditLine {
  kind: 'prep';
  key: string;
  prepId: string;
  name: string;
  /** Portions of the preparation for the whole recipe. */
  qty: string;
  exact?: number;
}
export type EditLine = IngredientEditLine | PrepEditLine;

let counter = 0;
export const newKey = () => `new-${++counter}`;
export const parseQty = (value: string) => Number(value.replace(',', '.'));
/** The quantity to send: the stored one while untouched, else what was typed. */
const qtyOf = (l: { qty: string; exact?: number }) =>
  l.exact !== undefined && (l.qty === qtyText(l.exact) || l.qty === String(l.exact))
    ? l.exact
    : parseQty(l.qty);

/** A quantity on screen: three decimals at most (only computed ones have more), comma. */
export const qtyText = (qty: number) => String(Math.round(qty * 1000) / 1000).replace('.', ',');

/** What a preparation line stands for, in ingredients (read only, beside the line). */
export function prepLineText(
  prep: PrepDto | undefined,
  portions: number,
  names: ReadonlyMap<string, string>,
): string {
  if (!prep) return '';
  if (!(portions > 0)) return '';
  return prep.items
    .map(
      (i) => `${names.get(i.ingredientId) ?? '?'} ${qtyText(product(i.qty, portions))} ${i.unit}`,
    )
    .join(' · ');
}

/** The body of the lines sent to the server (ingredient lines as before, preparation lines `{ kind: 'prep' }`). */
export function linesBody(lines: readonly EditLine[]) {
  return lines
    .filter((l) => l.name.trim())
    .map((l) =>
      l.kind === 'prep'
        ? { kind: 'prep', prepId: l.prepId, qty: qtyOf(l) }
        : {
            ingredientId: l.ingredientId || undefined,
            name: l.name,
            qty: qtyOf(l),
            unit: l.unit || 'g',
          },
    );
}

export function IngredientRow(props: {
  line: IngredientEditLine;
  ingredients: readonly IngredientDto[];
  onChange: (line: IngredientEditLine) => void;
  onRemove: () => void;
  /** « Extraire en préparation »: the line can be ticked. */
  select?: { checked: boolean; onToggle: () => void };
  /** Shown after the line (e.g. « au moment du repas »). */
  note?: string;
}) {
  const l = props.line;
  const set = (patch: Partial<IngredientEditLine>) => props.onChange({ ...l, ...patch });
  const pick = (value: string) => {
    const found = props.ingredients.find((i) => fold(i.name) === fold(value));
    set(
      found
        ? { name: found.name, ingredientId: found.id, unit: l.unit || found.unit }
        : { name: value, ingredientId: '' },
    );
  };
  return (
    <div className="cs-row">
      {props.select && (
        <input
          type="checkbox"
          checked={props.select.checked}
          aria-label={`Choisir ${l.name || 'la ligne'}`}
          onChange={props.select.onToggle}
        />
      )}
      <Suggest
        className="cs-grow"
        value={l.name}
        options={props.ingredients.map((i) => i.name)}
        placeholder="Ingrédient"
        ariaLabel="Ingrédient"
        onChange={pick}
      />
      <input
        className="input input--short num"
        value={l.qty}
        placeholder="qté"
        aria-label="Quantité"
        onChange={(e) => set({ qty: e.target.value })}
      />
      <select
        className="input input--short"
        value={l.unit}
        aria-label="Unité"
        onChange={(e) => set({ unit: e.target.value })}
      >
        {[...new Set([...UNITS, l.unit].filter(Boolean))].map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      {l.name.trim() && !l.ingredientId && <span className="small cs-new">nouvel ingrédient</span>}
      {props.note && <span className="small muted">{props.note}</span>}
      <button type="button" className="cs-x" aria-label="Retirer la ligne" onClick={props.onRemove}>
        <Icon name="close" />
      </button>
    </div>
  );
}

export interface KeepState {
  fridgeDays: string;
  freezable: boolean;
  freezerDays: string;
}
export const keepState = (k: {
  fridgeDays: number | null;
  freezable: boolean;
  freezerDays: number | null;
}): KeepState => ({
  fridgeDays: k.fridgeDays === null ? '' : String(k.fridgeDays),
  freezable: k.freezable,
  freezerDays: k.freezerDays === null ? '' : String(k.freezerDays),
});
export const keepBody = (k: KeepState) => ({
  fridgeDays: k.fridgeDays.trim() === '' ? null : Number(k.fridgeDays),
  freezable: k.freezable,
  freezerDays: !k.freezable || k.freezerDays.trim() === '' ? null : Number(k.freezerDays),
});

/** Keeping once cooked: empty by default, never suggested, filled in by Thomas only. */
export function KeepFields(props: {
  value: KeepState;
  onChange: (value: KeepState) => void;
  legend: string;
  /** A split recipe: the fields stay, without effect (said). */
  note?: string;
}) {
  const k = props.value;
  const set = (patch: Partial<KeepState>) => props.onChange({ ...k, ...patch });
  return (
    <fieldset className="cs-keep">
      <legend className="small">{props.legend}</legend>
      {props.note && <p className="small cs-batch-warning cs-keep__note">{props.note}</p>}
      <label className="small">
        Frigo{' '}
        <input
          className="input input--short num"
          type="number"
          min={0}
          max={3650}
          step={1}
          value={k.fridgeDays}
          placeholder="?"
          aria-label="Jours au frigo"
          onChange={(e) => set({ fridgeDays: e.target.value })}
        />{' '}
        jour(s)
      </label>
      <label className="small">
        <input
          type="checkbox"
          checked={k.freezable}
          onChange={(e) => set({ freezable: e.target.checked })}
        />{' '}
        Congelable
      </label>
      {k.freezable && (
        <label className="small">
          Congélateur{' '}
          <input
            className="input input--short num"
            type="number"
            min={0}
            max={3650}
            step={1}
            value={k.freezerDays}
            placeholder="?"
            aria-label="Jours au congélateur"
            onChange={(e) => set({ freezerDays: e.target.value })}
          />{' '}
          jour(s)
        </label>
      )}
    </fieldset>
  );
}

/** « Frigo 3 j · congelable 60 j », or that it is missing. */
export function keepText(k: {
  fridgeDays: number | null;
  freezable: boolean;
  freezerDays: number | null;
}) {
  if (k.fridgeDays === null && !k.freezable) return 'conservation non renseignée';
  return `Frigo ${k.fridgeDays === null ? '?' : `${k.fridgeDays} j`}${
    k.freezable
      ? ` · congelable ${k.freezerDays === null ? '(durée ?)' : `${k.freezerDays} j`}`
      : ' · non congelable'
  }`;
}
