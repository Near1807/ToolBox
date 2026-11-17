// v0.42.0 (Expérimental): Réglages › Agenda › Catégories, and the choice of
// a category in the sheet, the bar and an empty slot. Thomas's own
// categories: created, renamed, coloured, given a shape, deleted (their
// events moved, never deleted; backup, « Annuler »). The fixed ones and
// the other tools': their colour only (and counted / shown by default).
import { useRef, useState } from 'react';
import {
  Button,
  ErrorMessage,
  errorMessage,
  UndoToast,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import type { CategoryDto, CategoryShape } from '../shared/categories';
import { colorLabel, isFreeColor, PALETTE, parseColor, toHex } from '../shared/palette';
import {
  categoryInfo,
  colorStyle,
  freeColorInk,
  knownCategories,
  rememberCategory,
} from './common';

const ORIGIN: Record<CategoryDto['origin'], string> = {
  fixed: 'de l’Agenda : seule la couleur change',
  tool: 'd’un autre outil : seule la couleur change',
  mine: 'à toi',
  used: 'trouvée dans tes événements : seule la couleur change',
};

const SHAPE: Record<CategoryShape, string> = { normal: 'Normale', deadline: 'Deadline' };

/** The colour of a category: the 16 hues, a free colour, back to the original. */
export function ColorChooser(props: {
  /** Stored: « p:<id> », « #rrggbb », or null (the original). */
  value: string | null;
  /** Its CSS value now (to start the free colour from it). */
  css: string;
  onChange: (value: string | null) => void;
}) {
  const [free, setFree] = useState<string | null>(isFreeColor(props.value) ? props.value : null);
  const [startHex, setStartHex] = useState<string | null>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const ink = free ? freeColorInk(free) : null;
  return (
    <div className="ag-colors">
      <div className="ag-colors__swatches" role="radiogroup" aria-label="Couleur">
        {PALETTE.map((p) => {
          const value = `p:${p.id}`;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={props.value === value}
              className={`ag-swatch${props.value === value ? ' ag-swatch--on' : ''}`}
              style={{ '--ag-color': `var(--hue-${p.id})` } as React.CSSProperties}
              title={p.label}
              aria-label={p.label}
              onClick={() => {
                setFree(null);
                props.onChange(value);
              }}
            />
          );
        })}
      </div>
      <div className="ag-colors__row">
        <span
          ref={probe}
          className="ag-swatch ag-swatch--preview"
          style={{ '--ag-color': free ?? props.css } as React.CSSProperties}
          aria-hidden="true"
        />
        <label className="small">
          Couleur libre{' '}
          <input
            type="color"
            value={free ?? startHex ?? toHex(parseColor(props.css) ?? [128, 128, 128])}
            onFocus={() => {
              // The picker starts from the colour shown now (a theme token is resolved here).
              const rgb = probe.current
                ? parseColor(getComputedStyle(probe.current).backgroundColor)
                : null;
              if (!free && rgb) setStartHex(toHex(rgb));
            }}
            onChange={(e) => setFree(e.target.value)}
          />
        </label>
        {free && free !== props.value && (
          <Button small onClick={() => props.onChange(free)}>
            Appliquer
          </Button>
        )}
        {props.value !== null && (
          <Button
            small
            variant="secondary"
            onClick={() => {
              setFree(null);
              props.onChange(null);
            }}
          >
            Revenir à la couleur d’origine
          </Button>
        )}
      </div>
      {ink?.low && (
        <p className="small ag-colors__warn" role="alert">
          Contraste faible ({ink.ratio.toFixed(1)}:1) : le texte des blocs risque d’être difficile à
          lire avec ce thème. Choisis une couleur plus franche ou une teinte de la palette.
        </p>
      )}
      <p className="small muted">Actuelle : {colorLabel(props.value)}</p>
    </div>
  );
}

function CategoryRow(props: {
  category: CategoryDto;
  all: CategoryDto[];
  first: boolean;
  last: boolean;
  onChanged: () => void;
  onMove: (delta: -1 | 1) => void;
  onUndo: (undo: { message: string; undoId: string }) => void;
}) {
  const module = useModule();
  const c = props.category;
  const mine = c.origin === 'mine';
  const [colors, setColors] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/categories/${encodeURIComponent(c.key)}`;
  const run = (task: () => Promise<unknown>) => {
    setError(null);
    task().then(props.onChanged, (e: unknown) => setError(errorMessage(e)));
  };
  const others = props.all.filter((x) => x.key !== c.key && x.shape === c.shape);
  return (
    <li className="list__item list__item--top ag-cats__item">
      <div className="ag-cats__main">
        <span className="ag-dot" style={colorStyle(c.name)} aria-hidden="true" />
        <div>
          <strong>{c.name}</strong>{' '}
          <span className="muted small">
            {SHAPE[c.shape]} · {c.events} élément{c.events > 1 ? 's' : ''} · {ORIGIN[c.origin]}
          </span>
          <div className="ag-cats__flags small">
            <label className="ag-check">
              <input
                type="checkbox"
                checked={c.counted}
                disabled={c.shape === 'deadline'}
                onChange={(e) => run(() => module.api.patch(url, { counted: e.target.checked }))}
              />{' '}
              {c.shape === 'deadline' ? 'Jamais comptée (deadline)' : 'Comptée dans la charge'}
            </label>
            <label className="ag-check">
              <input
                type="checkbox"
                checked={c.shownByDefault}
                onChange={(e) =>
                  run(() => module.api.patch(url, { shownByDefault: e.target.checked }))
                }
              />{' '}
              Allumée par défaut
            </label>
            {mine && (
              <label>
                Forme{' '}
                <select
                  className="input input--small"
                  value={c.shape}
                  onChange={(e) => run(() => module.api.patch(url, { shape: e.target.value }))}
                >
                  <option value="normal">Normale (un bloc de temps)</option>
                  <option value="deadline">Deadline (un moment, en rouge)</option>
                </select>
              </label>
            )}
          </div>
        </div>
        <div className="ui-actions ag-cats__actions">
          <Button small variant="secondary" onClick={() => setColors((v) => !v)}>
            Couleur
          </Button>
          <Button
            small
            variant="secondary"
            disabled={props.first}
            aria-label={`Monter ${c.name}`}
            onClick={() => props.onMove(-1)}
          >
            Monter
          </Button>
          <Button
            small
            variant="secondary"
            disabled={props.last}
            aria-label={`Descendre ${c.name}`}
            onClick={() => props.onMove(1)}
          >
            Descendre
          </Button>
          {mine && (
            <>
              <Button small variant="secondary" onClick={() => setRenaming(c.name)}>
                Renommer
              </Button>
              <Button
                small
                variant="danger"
                onClick={() => {
                  if (c.events === 0) {
                    if (!window.confirm(`Supprimer la catégorie « ${c.name} » ?`)) return;
                    run(async () => {
                      const r = await module.api.delete<{ undoId: string }>(url);
                      props.onUndo({ message: `« ${c.name} » supprimée`, undoId: r.undoId });
                    });
                  } else setDeleting(others[0]?.name ?? '');
                }}
              >
                Supprimer
              </Button>
            </>
          )}
        </div>
      </div>
      {colors && (
        <ColorChooser
          value={c.color}
          css={c.css}
          onChange={(value) => run(() => module.api.patch(url, { color: value }))}
        />
      )}
      {renaming !== null && (
        <form
          className="ag-form__row"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await module.api.post<{ undoId: string | null }>(`${url}/rename`, {
                name: renaming,
              });
              setRenaming(null);
              if (r.undoId)
                props.onUndo({
                  message: `« ${c.name} » renommée en « ${renaming.trim()} »`,
                  undoId: r.undoId,
                });
            });
          }}
        >
          <label>
            Nouveau nom
            <input
              className="input"
              value={renaming}
              maxLength={40}
              onChange={(e) => setRenaming(e.target.value)}
              required
            />
          </label>
          <p className="small muted">
            Ses événements, la semaine type et les correspondances d’import suivent (une sauvegarde
            est faite avant).
          </p>
          <div className="ui-actions">
            <Button small type="submit">
              Renommer
            </Button>
            <Button small type="button" variant="secondary" onClick={() => setRenaming(null)}>
              Annuler
            </Button>
          </div>
        </form>
      )}
      {deleting !== null && (
        <div className="ag-cats__delete">
          <label>
            Elle a {c.events} élément{c.events > 1 ? 's' : ''} : les déplacer vers{' '}
            <select
              className="input input--small"
              value={deleting}
              onChange={(e) => setDeleting(e.target.value)}
            >
              {others.map((o) => (
                <option key={o.key} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">
            Aucun événement n’est supprimé. Une sauvegarde est faite avant ; « Annuler » remet tout.
          </p>
          <div className="ui-actions">
            <Button
              small
              variant="danger"
              disabled={!deleting}
              onClick={() => {
                if (
                  !window.confirm(
                    `Supprimer « ${c.name} » et déplacer ses ${c.events} élément(s) vers « ${deleting} » ?`,
                  )
                )
                  return;
                run(async () => {
                  const r = await module.api.delete<{ undoId: string }>(
                    `${url}?moveTo=${encodeURIComponent(deleting)}`,
                  );
                  setDeleting(null);
                  props.onUndo({
                    message: `« ${c.name} » supprimée, ses éléments sont dans « ${deleting} »`,
                    undoId: r.undoId,
                  });
                });
              }}
            >
              Supprimer et déplacer
            </Button>
            <Button small variant="secondary" onClick={() => setDeleting(null)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </li>
  );
}

/** « Nouvelle catégorie »: a name and a colour (Réglages, or without leaving the sheet). */
export function NewCategoryForm(props: {
  onCreated: (c: CategoryDto) => void;
  onCancel?: () => void;
}) {
  const module = useModule();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>('p:violet');
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    setError(null);
    module.api.post<CategoryDto>('/categories', { name, color }).then(
      (c) => {
        rememberCategory(c);
        setName('');
        props.onCreated(c);
      },
      (e: unknown) => setError(errorMessage(e)),
    );
  };
  return (
    <div className="ag-newcat">
      <label>
        Nom de la catégorie
        <input
          className="input"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Inside another form (the sheet): never submit it.
              e.preventDefault();
              if (name.trim()) create();
            }
          }}
        />
      </label>
      <ColorChooser
        value={color}
        css={`var(--hue-${color?.slice(2) ?? 'violet'})`}
        onChange={setColor}
      />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="ui-actions">
        <Button small type="button" disabled={!name.trim()} onClick={create}>
          Créer
        </Button>
        {props.onCancel && (
          <Button small type="button" variant="secondary" onClick={props.onCancel}>
            Annuler
          </Button>
        )}
      </div>
    </div>
  );
}

/** Réglages › Agenda › Catégories. */
export function CategoriesPanel() {
  const module = useModule();
  const { data, error, reload } = useApi<CategoryDto[]>(module.url('/categories'));
  const [undo, setUndo] = useState<{ message: string; undoId: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const move = (index: number, delta: -1 | 1) => {
    if (!data) return;
    const keys = data.map((c) => c.key);
    const [k] = keys.splice(index, 1);
    keys.splice(index + delta, 0, k!);
    module.api
      .put('/categories/order', { keys })
      .then(reload, (e: unknown) => setFailure(errorMessage(e)));
  };
  return (
    <div className="ag-cats">
      <p className="small">
        <span className="badge badge--warning">Expérimental</span> Leur couleur s’applique partout
        (semaine, jour, interrupteurs, aperçu, fiche, résumé). Tant que tu ne changes rien, tout
        reste comme avant.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {failure && <ErrorMessage>{failure}</ErrorMessage>}
      {adding ? (
        <NewCategoryForm
          onCreated={() => {
            setAdding(false);
            reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button small onClick={() => setAdding(true)}>
          Nouvelle catégorie
        </Button>
      )}
      {data && (
        <ul className="list ag-cats__list">
          {data.map((c, i) => (
            <CategoryRow
              key={c.key}
              category={c}
              all={data}
              first={i === 0}
              last={i === data.length - 1}
              onChanged={reload}
              onMove={(d) => move(i, d)}
              onUndo={setUndo}
            />
          ))}
        </ul>
      )}
      {undo && (
        <UndoToast
          message={undo.message}
          onDismiss={() => setUndo(null)}
          onUndo={() => {
            module.api
              .post('/categories/undo', { undoId: undo.undoId })
              .then(reload, (e: unknown) => setFailure(errorMessage(e)));
          }}
          timeoutMs={20_000}
        />
      )}
    </div>
  );
}

const NEW = '\u0000new';

/**
 * The choice of a category (sheet, bar, empty slot): every category in
 * Thomas's order, and « Nouvelle catégorie… », created without leaving.
 */
export function CategorySelect(props: {
  value: string;
  onChange: (name: string) => void;
  className?: string;
  label?: string;
  /** An empty choice first (« Selon le texte »), value ''. */
  empty?: string;
}) {
  const module = useModule();
  const [creating, setCreating] = useState(false);
  const { data } = useApi<CategoryDto[]>(module.url('/categories'));
  const [added, setAdded] = useState<CategoryDto[]>([]);
  const base = data ?? knownCategories();
  const list = [...base, ...added.filter((a) => !base.some((c) => c.key === a.key))];
  const known = list.some((c) => c.name === props.value) || !props.value;
  return (
    <>
      <select
        className={props.className ?? 'input'}
        aria-label={props.label ?? 'Catégorie'}
        value={creating ? NEW : props.value}
        onChange={(e) => {
          if (e.target.value === NEW) setCreating(true);
          else {
            setCreating(false);
            props.onChange(e.target.value);
          }
        }}
      >
        {props.empty !== undefined && <option value="">{props.empty}</option>}
        {!known && <option value={props.value}>{props.value}</option>}
        {list.map((c) => (
          <option key={c.key} value={c.name}>
            {c.name}
            {c.shape === 'deadline' ? ' (deadline)' : ''}
          </option>
        ))}
        <option value={NEW}>Nouvelle catégorie…</option>
      </select>
      {creating && (
        <NewCategoryForm
          onCreated={(c) => {
            setCreating(false);
            setAdded((a) => [...a, c]);
            props.onChange(c.name);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </>
  );
}

/** The shape of the category chosen (a deadline has no end). */
export const shapeOfChoice = (name: string): CategoryShape =>
  categoryInfo(name)?.shape ?? (name.trim().toLowerCase() === 'deadline' ? 'deadline' : 'normal');
