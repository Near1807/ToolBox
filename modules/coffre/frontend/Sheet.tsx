// v0.45.0, v0.50.0: the sheet of a file — its route and its labels, by family
// (several values each). A label the Coffre guessed is marked « deviné » (its
// reason on hover), one from its folder « par défaut du dossier »; each family
// changes in one click (list with a search, creation on the spot); a changed
// value is « choisi » and no deduction replaces it. Used by the rangement
// window (applied on « Ranger ») and by the preview (applied at once).
import { useState, type ReactNode } from 'react';
import { Icon } from '@hub/sdk/frontend';
import { LANGUAGE_CHOICES, NATURE_CHOICES, ORIGIN_CHOICES } from '../shared/kinds';
import { FAMILY_NAMES, LABEL_FAMILIES, type LabelDto, type LabelFamily } from '../shared/types';
import { useCoffre } from './frame';
import { choiceLabel, choiceToPick, pickToChoice, type FolderChoice } from './logic';
import { Picker, type PickerOption } from './Picker';
import { RoutePicker } from './RoutePicker';

const BASE: Partial<Record<LabelFamily, readonly string[]>> = {
  nature: NATURE_CHOICES,
  origin: ORIGIN_CHOICES,
  language: LANGUAGE_CHOICES,
};

export function labelOptions(key: LabelFamily, known: Record<string, string[]>): PickerOption[] {
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

/** The origin of a label: « deviné » or « par défaut du dossier » (nothing for « choisi »). */
function LabelOriginMark(props: { label: Pick<LabelDto, 'origin' | 'reason'> }) {
  if (props.label.origin === 'guessed') return <Guessed reason={props.label.reason} />;
  if (props.label.origin === 'default')
    return (
      <span className="coffre-guess" title={props.label.reason ?? 'Par défaut du dossier'}>
        par défaut
      </span>
    );
  return null;
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="coffre-sheet__row">
      <span className="coffre-sheet__label">{props.label}</span>
      <div className="coffre-sheet__value">{props.children}</div>
    </div>
  );
}

export function Sheet(props: {
  choice: FolderChoice;
  onChoice?: (choice: FolderChoice) => void;
  labels: LabelDto[];
  onValues: (key: LabelFamily, values: string[]) => void;
  /** A value's « voir tout » (the view by label). */
  onShowAll?: (key: LabelFamily, value: string) => void;
  /** Why the route cannot change here (inside a project: indivisible), or null. */
  routeLocked?: string | null;
  /** A folder dropped: no « À ranger » for it. */
  folder?: boolean;
  /** Leading rows (the name…). */
  children?: ReactNode;
}) {
  const { folders, values } = useCoffre();
  const [editing, setEditing] = useState<LabelFamily | 'route' | null>(null);
  const byKey = (key: LabelFamily) => props.labels.filter((a) => a.family === key);

  const choice = props.choice;
  return (
    <div className="coffre-sheet">
      {props.children}
      <Row label="Route">
        <button
          type="button"
          className={`coffre-sheet__pick${choice ? '' : ' coffre-sheet__pick--empty'}`}
          disabled={Boolean(props.routeLocked) || !props.onChoice}
          title={props.routeLocked ?? undefined}
          onClick={() => setEditing('route')}
        >
          {choiceLabel(choice, folders)}
        </button>
        {choice?.origin === 'guessed' && <Guessed reason={choice.reason} />}
        {editing === 'route' && props.onChoice && (
          <RoutePicker
            label="Route"
            folders={folders.filter((f) => !f.project)}
            pending={!props.folder}
            proposed={
              choice?.origin === 'guessed'
                ? {
                    pick: choiceToPick(choice),
                    label: choiceLabel(choice, folders),
                    reason: choice.reason,
                  }
                : null
            }
            onClose={() => setEditing(null)}
            onPick={(pick) => {
              setEditing(null);
              props.onChoice?.(pickToChoice(pick));
            }}
          />
        )}
      </Row>
      {LABEL_FAMILIES.map((key) => {
        const list = byKey(key);
        return (
          <Row key={key} label={FAMILY_NAMES[key]}>
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
                <LabelOriginMark label={a} />
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
            <button
              type="button"
              className="coffre-sheet__pick coffre-sheet__pick--empty"
              aria-label={`Ajouter : ${FAMILY_NAMES[key]}`}
              onClick={() => setEditing(key)}
            >
              {list.length ? '+' : '—'}
            </button>
            {editing === key && (
              <Picker
                label={FAMILY_NAMES[key]}
                options={labelOptions(key, values).filter(
                  (o) => !list.some((a) => a.value.toLowerCase() === o.value.toLowerCase()),
                )}
                createLabel={(t) => `Ajouter « ${t} »`}
                onClose={() => setEditing(null)}
                onPick={(value) => {
                  setEditing(null);
                  props.onValues(key, [...list.map((a) => a.value), value]);
                }}
              />
            )}
          </Row>
        );
      })}
    </div>
  );
}
