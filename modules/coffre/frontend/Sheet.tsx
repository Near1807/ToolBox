// The sheet of an element: its context and its attributes. A value the Coffre
// guessed is marked « deviné » (its reason on hover); each field changes in
// one click (list with a search, creation on the spot); a changed value is
// « choisi » and no deduction replaces it. Used by the rangement window
// (applied on « Ranger ») and by the preview (applied at once).
import { useState, type ReactNode } from 'react';
import { Icon } from '@hub/sdk/frontend';
import { LANGUAGE_CHOICES, NATURE_CHOICES, ORIGIN_CHOICES } from '../shared/kinds';
import {
  ATTRIBUTE_LABELS,
  type AttributeDto,
  type AttributeKey,
  type ContextDto,
} from '../shared/types';
import { useCoffre } from './frame';
import { choiceLabel, contextOfPath, parseContextPath, type ContextChoice } from './logic';
import { Picker, type PickerOption } from './Picker';

/** The fields of the sheet, in this order. */
const FIELDS: AttributeKey[] = [
  'nature',
  'origin',
  'language',
  'application',
  'prof',
  'year',
  'site',
  'tag',
];

const BASE: Partial<Record<AttributeKey, readonly string[]>> = {
  nature: NATURE_CHOICES,
  origin: ORIGIN_CHOICES,
  language: LANGUAGE_CHOICES,
};

function optionsOf(key: AttributeKey, known: Record<string, string[]>): PickerOption[] {
  const year = new Date().getFullYear();
  const base =
    key === 'year' ? [year, year - 1, year - 2, year - 3].map(String) : (BASE[key] ?? []);
  const seen = new Map<string, string>();
  for (const v of [...(known[key] ?? []), ...base])
    if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].map((v) => ({ value: v, label: v }));
}

export function Guessed(props: { reason: string | null }) {
  return (
    <span className="coffre-guess" title={props.reason ? `Deviné : ${props.reason}` : 'Deviné'}>
      deviné
    </span>
  );
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="coffre-sheet__row">
      <span className="coffre-sheet__label">{props.label}</span>
      <div className="coffre-sheet__value">{props.children}</div>
    </div>
  );
}

export function contextOptions(contexts: readonly ContextDto[]): PickerOption[] {
  return [...contexts]
    .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), 'fr'))
    .map((c) => ({
      value: c.id,
      label: c.path.join(' › '),
      hint: c.count ? String(c.count) : undefined,
    }));
}

/** What a context typed gives: the existing one of that path, or a new one. */
export function choiceOfTyped(text: string, contexts: readonly ContextDto[]): ContextChoice {
  const names = parseContextPath(text);
  if (!names.length) return null;
  const found = contextOfPath(contexts, names);
  return found
    ? { kind: 'existing', id: found.id, origin: 'chosen', reason: null }
    : { kind: 'new', path: names, origin: 'chosen', reason: null };
}

export function Sheet(props: {
  choice: ContextChoice;
  onChoice: (choice: ContextChoice) => void;
  attributes: AttributeDto[];
  onValues: (key: AttributeKey, values: string[]) => void;
  /** A link: « lien externe, non sauvegardé ». */
  link?: boolean;
  /** A value's « voir tous » (the view by attribute). */
  onShowAll?: (key: AttributeKey, value: string) => void;
  /** Leading rows (the name…). */
  children?: ReactNode;
}) {
  const { contexts, values } = useCoffre();
  const [editing, setEditing] = useState<AttributeKey | 'context' | null>(null);
  const byKey = (key: AttributeKey) => props.attributes.filter((a) => a.key === key);

  const ctxChoice = props.choice;
  return (
    <div className="coffre-sheet">
      {props.link && (
        <p className="coffre-link-badge">
          <Icon name="external-link" /> Lien externe, non sauvegardé : le fichier reste à sa place,
          le Coffre ne le copie pas.
        </p>
      )}
      {props.children}
      <Row label="Contexte">
        <button
          type="button"
          className={`coffre-sheet__pick${ctxChoice ? '' : ' coffre-sheet__pick--empty'}`}
          onClick={() => setEditing('context')}
        >
          {choiceLabel(ctxChoice, contexts)}
        </button>
        {ctxChoice?.origin === 'guessed' && <Guessed reason={ctxChoice.reason} />}
        {editing === 'context' && (
          <Picker
            label="Contexte"
            options={[
              ...contextOptions(contexts),
              { value: '', label: 'Arrivée (à ranger plus tard)' },
            ]}
            createLabel={(t) => `Créer le contexte « ${parseContextPath(t).join(' › ')} »`}
            onClose={() => setEditing(null)}
            onPick={(value, created) => {
              setEditing(null);
              if (created) props.onChoice(choiceOfTyped(value, contexts));
              else
                props.onChoice(
                  value ? { kind: 'existing', id: value, origin: 'chosen', reason: null } : null,
                );
            }}
          />
        )}
      </Row>
      {FIELDS.map((key) => {
        const list = byKey(key);
        const multi = key === 'tag';
        return (
          <Row key={key} label={multi ? 'Tags' : ATTRIBUTE_LABELS[key]}>
            {list.map((a) => (
              <span key={a.value} className="coffre-value">
                {props.onShowAll ? (
                  <button
                    type="button"
                    className="coffre-value__text"
                    title={`Voir tout ce qui est « ${a.value} »`}
                    onClick={() => props.onShowAll?.(key, a.value)}
                  >
                    {a.value}
                  </button>
                ) : (
                  <span className="coffre-value__text">{a.value}</span>
                )}
                {a.origin === 'guessed' && <Guessed reason={a.reason} />}
                <button
                  type="button"
                  className="coffre-value__remove"
                  aria-label={`Retirer « ${a.value} »`}
                  title="Retirer"
                  onClick={() =>
                    props.onValues(
                      key,
                      list.filter((x) => x.value !== a.value).map((x) => x.value),
                    )
                  }
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
            {(multi || !list.length) && (
              <button
                type="button"
                className="coffre-sheet__pick coffre-sheet__pick--empty"
                onClick={() => setEditing(key)}
              >
                {multi ? '+ tag' : '—'}
              </button>
            )}
            {!multi && list.length > 0 && (
              <button
                type="button"
                className="icon-button coffre-sheet__change"
                aria-label={`Changer ${ATTRIBUTE_LABELS[key]}`}
                title="Changer"
                onClick={() => setEditing(key)}
              >
                <Icon name="pencil" />
              </button>
            )}
            {editing === key && (
              <Picker
                label={ATTRIBUTE_LABELS[key]}
                options={optionsOf(key, values).filter(
                  (o) => !list.some((a) => a.value.toLowerCase() === o.value.toLowerCase()),
                )}
                createLabel={(t) => (multi ? `Créer le tag « ${t} »` : `« ${t} »`)}
                onClose={() => setEditing(null)}
                onPick={(value) => {
                  setEditing(null);
                  props.onValues(key, multi ? [...list.map((a) => a.value), value] : [value]);
                }}
              />
            )}
          </Row>
        );
      })}
    </div>
  );
}
