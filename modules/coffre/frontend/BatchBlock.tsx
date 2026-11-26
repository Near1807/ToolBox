// v0.48.0 (Expérimental): the « Pour tous » block — one setting for a batch:
// route (the route picker), nature, origin, year, free labels added / removed, a named set, an
// optional rename template ({nom}, {n}, {date}, {dossier}) with a preview of
// the names. A field that differs among the files shows « mixte » as long as
// it is not changed. The same block in the rangement window and for
// « Modifier la sélection » of elements already stored.
import { useState } from 'react';
import { Icon } from '@hub/sdk/frontend';
import { TEMPLATE_TOKENS } from '../shared/batch';
import { NATURE_CHOICES, ORIGIN_CHOICES } from '../shared/kinds';
import type { FolderDto } from '../shared/types';
import { useCoffre } from './frame';
import { choiceLabel, pickToChoice, type BatchValues, type batchSummary } from './logic';
import { RoutePicker } from './RoutePicker';
import { SetPicker } from './Labels';

type Summary = ReturnType<typeof batchSummary>;
const MIXED = '__mixte__';
const NONE = '__aucune__';

function AttrSelect(props: {
  label: string;
  choices: readonly string[];
  value: string | null | undefined;
  summary: Summary['nature'];
  onChange: (v: string | null | undefined) => void;
}) {
  const shown =
    props.value === undefined
      ? props.summary.mixed
        ? MIXED
        : (props.summary.value ?? NONE)
      : (props.value ?? NONE);
  const current = !props.summary.mixed ? props.summary.value : null;
  const list = [...new Set([...props.choices, ...(current ? [current] : [])])];
  return (
    <label className="coffre-batch__field">
      <span className="coffre-batch__label">{props.label}</span>
      <select
        className={`input${props.value === undefined && props.summary.mixed ? ' coffre-batch__mixed' : ''}`}
        value={shown}
        onChange={(e) =>
          props.onChange(
            e.target.value === MIXED ? undefined : e.target.value === NONE ? null : e.target.value,
          )
        }
      >
        {props.summary.mixed && <option value={MIXED}>mixte (inchangé)</option>}
        <option value={NONE}>—</option>
        {list.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BatchBlock(props: {
  count: number;
  values: BatchValues;
  summary: Summary;
  onChange: (v: BatchValues) => void;
  /** A few names after the template (the preview). */
  preview: { before: string; after: string }[];
  /** À ranger offered as a route (the rangement window). */
  pending?: boolean;
}) {
  const coffre = useCoffre();
  const { values: v, summary: s, onChange } = props;
  const [picking, setPicking] = useState(false);
  const [free, setFree] = useState('');
  const set = (change: Partial<BatchValues>) => onChange({ ...v, ...change });
  const addFree = () => {
    const t = free.trim();
    if (!t) return;
    set({
      freeAdd: v.freeAdd.some((x) => x.toLowerCase() === t.toLowerCase())
        ? v.freeAdd
        : [...v.freeAdd, t],
      freeRemove: v.freeRemove.filter((x) => x.toLowerCase() !== t.toLowerCase()),
    });
    setFree('');
  };
  const routeText =
    v.route !== undefined
      ? choiceLabel(v.route, coffre.folders as FolderDto[])
      : s.route.mixed
        ? 'mixte (inchangé)'
        : (s.route.value ?? '—');

  return (
    <section className="coffre-batch" aria-label="Pour tous" data-coffre-batch>
      <h3 className="coffre-batch__title">
        Pour tous{' '}
        <span className="muted small">
          ({props.count} coché{props.count > 1 ? 's' : ''})
        </span>
      </h3>
      <div className="coffre-batch__grid">
        <div className="coffre-batch__field coffre-batch__route">
          <span className="coffre-batch__label">Route</span>
          <button
            type="button"
            className={`coffre-sheet__pick${v.route === undefined && s.route.mixed ? ' coffre-batch__mixed' : ''}`}
            onClick={() => setPicking(true)}
            data-coffre-batch-route
          >
            {routeText}
          </button>
          {v.route !== undefined && (
            <button
              type="button"
              className="icon-button"
              aria-label="Ne plus changer la route"
              title="Ne plus changer la route"
              onClick={() => {
                const { route: _drop, ...rest } = v;
                void _drop;
                onChange(rest);
              }}
            >
              <Icon name="close" />
            </button>
          )}
          {picking && (
            <RoutePicker
              label="Route pour tous"
              folders={coffre.folders}
              pending={props.pending}
              onClose={() => setPicking(false)}
              onPick={(pick) => {
                setPicking(false);
                set({ route: pickToChoice(pick) });
              }}
            />
          )}
        </div>
        <AttrSelect
          label="Nature"
          choices={NATURE_CHOICES}
          value={v.nature}
          summary={s.nature}
          onChange={(nature) => set({ nature })}
        />
        <AttrSelect
          label="Origine"
          choices={ORIGIN_CHOICES}
          value={v.origin}
          summary={s.origin}
          onChange={(origin) => set({ origin })}
        />
        <label className="coffre-batch__field">
          <span className="coffre-batch__label">Année</span>
          <input
            className={`input${v.year === undefined && s.year.mixed ? ' coffre-batch__mixed' : ''}`}
            inputMode="numeric"
            placeholder={s.year.mixed ? 'mixte' : (s.year.value ?? '—')}
            value={v.year ?? ''}
            onChange={(e) => {
              const t = e.target.value.trim();
              set({ year: t ? t.slice(0, 4) : undefined });
            }}
          />
        </label>
        <div className="coffre-batch__field coffre-batch__labels">
          <span className="coffre-batch__label">Étiquettes libres</span>
          <div className="coffre-batch__chips">
            {[...s.free.everywhere, ...s.free.some]
              .filter(
                (t) =>
                  ![...v.freeRemove, ...v.freeAdd].some((x) => x.toLowerCase() === t.toLowerCase()),
              )
              .map((t) => (
                <span key={`has:${t}`} className="coffre-value">
                  <span className="coffre-value__text">
                    {t}
                    {s.free.some.includes(t) && <span className="muted small"> (certains)</span>}
                  </span>
                  <button
                    type="button"
                    className="coffre-value__remove"
                    aria-label={`Retirer « ${t} » de tous`}
                    title="Retirer de tous"
                    onClick={() => set({ freeRemove: [...v.freeRemove, t] })}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              ))}
            {v.freeAdd.map((t) => (
              <span key={`add:${t}`} className="coffre-value coffre-value--added">
                <span className="coffre-value__text">+ {t}</span>
                <button
                  type="button"
                  className="coffre-value__remove"
                  aria-label={`Ne plus ajouter « ${t} »`}
                  onClick={() =>
                    set({
                      freeAdd: v.freeAdd.filter((x) => x !== t),
                      freeRemove: [...v.freeRemove, t],
                    })
                  }
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
            {v.freeRemove.map((t) => (
              <span key={`rm:${t}`} className="coffre-value coffre-value--removed">
                <span className="coffre-value__text">− {t}</span>
                <button
                  type="button"
                  className="coffre-value__remove"
                  aria-label={`Ne plus retirer « ${t} »`}
                  onClick={() => set({ freeRemove: v.freeRemove.filter((x) => x !== t) })}
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
            <input
              className="input coffre-batch__free"
              placeholder="+ étiquette, Entrée"
              aria-label="Ajouter une étiquette libre à tous"
              value={free}
              onChange={(e) => setFree(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  addFree();
                }
              }}
            />
          </div>
        </div>
        {/* v0.50.0: a named set of labels added to all, in one click. */}
        <div className="coffre-batch__field coffre-batch__sets">
          <span className="coffre-batch__label">Ensemble</span>
          <div className="coffre-batch__chips">
            {(v.add ?? []).map((l) => (
              <span key={`${l.family}:${l.value}`} className="coffre-value coffre-value--added">
                <span className="coffre-value__text">+ {l.value}</span>
                <button
                  type="button"
                  className="coffre-value__remove"
                  aria-label={`Ne plus ajouter « ${l.value} »`}
                  onClick={() => set({ add: (v.add ?? []).filter((x) => x !== l) })}
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
            <SetPicker
              onPick={(setDto) =>
                set({
                  add: [
                    ...(v.add ?? []),
                    ...setDto.labels.filter(
                      (l) =>
                        !(v.add ?? []).some((x) => x.family === l.family && x.value === l.value),
                    ),
                  ],
                })
              }
            />
          </div>
        </div>
        <label className="coffre-batch__field coffre-batch__rename">
          <span className="coffre-batch__label">Renommer</span>
          <input
            className="input"
            placeholder="facultatif : Thermo - {nom}"
            aria-describedby="coffre-batch-tokens"
            value={v.template}
            onChange={(e) => set({ template: e.target.value })}
          />
          <span id="coffre-batch-tokens" className="muted small">
            {TEMPLATE_TOKENS.join(' ')} · l’extension est gardée · le nom d’origine reste cherchable
          </span>
        </label>
      </div>
      {v.template.trim() && props.preview.length > 0 && (
        <ul className="coffre-batch__preview" aria-label="Aperçu des noms">
          {props.preview.slice(0, 3).map((p) => (
            <li key={p.before}>
              <span className="muted">{p.before}</span> <Icon name="chevron-right" />{' '}
              <strong>{p.after}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
