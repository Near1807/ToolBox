// Preparations (v0.27), a sub-tab of « Repas »: technical sheets defined once
// and used by several recipes. List (name, keeping, recipes using it),
// sheet (composition for ONE portion with the same line editor as the
// recipes, keeping, note), deletion refused while used (« Remplacer par ses
// ingrédients » offered in each recipe, confirmed), a warning before
// changing the composition of a used one.
import { useState } from 'react';
import { Button, Card, confirmDelete, EmptyState, useModule } from '@hub/sdk/frontend';
import { fold } from '../shared/quantities';
import type { PrepDto, StateDto } from '../shared/types';
import {
  IngredientRow,
  KeepFields,
  keepBody,
  keepState,
  keepText,
  linesBody,
  newKey,
  parseQty,
  qtyText,
  type IngredientEditLine,
} from './RecipeLines';

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

/** The idea, in a few lines (shown above the list). */
export function PrepHelp() {
  return (
    <details className="cs-batch-guide cs-prep-help">
      <summary>Les préparations, en bref</summary>
      <div className="small">
        <p>
          Une <strong>préparation</strong> est une fiche technique : définie une fois (sa
          composition pour <strong>une portion</strong> et sa conservation), elle sert à plusieurs
          recettes. Le riz cuit d’une session peut ainsi aller dans le chili et dans les boîtes.
        </p>
        <p>
          Dans une recette, une ligne « Sauce bolognaise × 4 portions » compte exactement comme ses
          ingrédients × 4 : apports, liste de courses, prix et résumé ne changent pas.
        </p>
        <p>
          Pour le batch cooking, une recette <strong>découpée</strong> (au moins une préparation)
          est préparée à l’avance par ses préparations ; ses lignes d’ingrédients directes se font{' '}
          <strong>au moment du repas</strong> (les pâtes de la bolognaise). Une recette non découpée
          est un bloc entier, avec sa propre conservation.
        </p>
        <p>
          <strong>Extraire en préparation</strong> (fiche d’une recette) : coche des lignes, nomme
          la préparation ; l’outil la crée et remplace les lignes, sans rien changer à ce que la
          recette représente.
        </p>
        <p>
          Les durées de conservation, c’est toi qui les renseignes : l’app ne les vérifie pas et
          n’en propose jamais.
        </p>
      </div>
    </details>
  );
}

const usedText = (p: PrepDto) =>
  p.usedBy.length
    ? `Utilisée par ${p.usedBy.map((u) => u.name).join(', ')}`
    : 'Utilisée par aucune recette';

export function Preps(props: {
  state: StateDto;
  run: Run;
  /** Opened directly (« compléter la fiche » of the batch tab). */
  editPrepId?: string | null;
  onDeleted: (p: PrepDto) => void;
}) {
  const module = useModule();
  const [editing, setEditing] = useState<string | 'new' | null>(props.editPrepId ?? null);
  const [q, setQ] = useState('');
  const [refused, setRefused] = useState<PrepDto | null>(null);
  const prep = props.state.preps.find((p) => p.id === editing);
  if (editing === 'new' || prep)
    return (
      <PrepEditor
        key={editing}
        prep={prep ?? null}
        state={props.state}
        run={props.run}
        onDone={() => setEditing(null)}
      />
    );
  const shown = props.state.preps.filter((p) => fold(p.name).includes(fold(q)));
  /** « Remplacer par ses ingrédients » in every recipe using it (same expansion), confirmed. */
  const inlineEverywhere = (p: PrepDto) => {
    if (
      !window.confirm(
        `Remplacer « ${p.name} » par ses ingrédients dans ${p.usedBy.map((u) => `« ${u.name} »`).join(', ')} ? Ces recettes gardent exactement les mêmes ingrédients ; la préparation pourra ensuite être supprimée.`,
      )
    )
      return;
    void props
      .run(async () => {
        for (const u of p.usedBy) {
          const meal = props.state.meals.find((m) => m.id === u.id);
          for (const l of meal?.lines ?? [])
            if (l.kind === 'prep' && l.prepId === p.id)
              await module.api.post(`/meals/${u.id}/inline`, { lineId: l.id });
        }
      })
      .then((ok) => ok && setRefused(null));
  };
  return (
    <>
      <PrepHelp />
      <div className="cs-row">
        <input
          className="input cs-grow"
          type="search"
          value={q}
          placeholder="Rechercher une préparation"
          aria-label="Rechercher une préparation"
          onChange={(e) => setQ(e.target.value)}
        />
        <Button onClick={() => setEditing('new')}>Nouvelle préparation</Button>
      </div>
      {refused && (
        <Card title={`« ${refused.name} » est utilisée`}>
          <p className="small">
            Elle ne peut pas être supprimée tant qu’une recette l’utilise : {usedText(refused)}.
          </p>
          <div className="ui-actions">
            <Button small onClick={() => inlineEverywhere(refused)}>
              Remplacer par ses ingrédients dans ces recettes…
            </Button>
            <Button small variant="secondary" onClick={() => setRefused(null)}>
              Fermer
            </Button>
          </div>
        </Card>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title={
            props.state.preps.length
              ? 'Aucune préparation ne correspond.'
              : 'Aucune préparation pour l’instant.'
          }
        />
      ) : (
        <div className="cs-meals-list">
          {shown.map((p) => (
            <div key={p.id} className="cs-meal-row">
              <span className="cs-meal-row__text">
                <strong>{p.name}</strong>
                <span className="small muted"> · {keepText(p)}</span>
                <br />
                <span className="small">{usedText(p)}</span>
              </span>
              <span className="ui-actions">
                <Button variant="secondary" small onClick={() => setEditing(p.id)}>
                  Modifier
                </Button>
                <Button
                  variant="danger"
                  small
                  onClick={() => {
                    if (p.usedBy.length) return setRefused(p);
                    if (confirmDelete(`la préparation « ${p.name} »`))
                      void props
                        .run(() => module.api.delete(`/preps/${p.id}`))
                        .then((ok) => ok && props.onDeleted(p));
                  }}
                >
                  Supprimer
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function PrepEditor(props: {
  prep: PrepDto | null;
  state: StateDto;
  run: Run;
  onDone: () => void;
}) {
  const module = useModule();
  const names = new Map(props.state.ingredients.map((i) => [i.id, i.name]));
  const [name, setName] = useState(props.prep?.name ?? '');
  const [note, setNote] = useState(props.prep?.note ?? '');
  const [keep, setKeep] = useState(
    keepState(props.prep ?? { fridgeDays: null, freezable: false, freezerDays: null }),
  );
  const [lines, setLines] = useState<IngredientEditLine[]>(
    props.prep?.items.map((i) => ({
      kind: 'ingredient',
      key: i.id,
      ingredientId: i.ingredientId,
      name: names.get(i.ingredientId) ?? '',
      qty: qtyText(i.qty),
      unit: i.unit,
      exact: i.qty,
    })) ?? [],
  );
  const composition = (
    list: { ingredientId?: string; name: string; qty: number; unit: string }[],
  ) => JSON.stringify(list.map((l) => [l.ingredientId ?? fold(l.name), l.qty, l.unit]));
  const save = () => {
    // Untouched quantities go back exactly as stored (the screen rounds them).
    const items = linesBody(lines) as {
      ingredientId?: string;
      name: string;
      qty: number;
      unit: string;
    }[];
    const before = props.prep
      ? composition(props.prep.items.map((i) => ({ ...i, name: names.get(i.ingredientId) ?? '' })))
      : '';
    const changed = Boolean(props.prep) && composition(items) !== before;
    const used = props.prep?.usedBy ?? [];
    const body = { name, note, ...keepBody(keep), items, confirmed: false };
    if (changed && used.length) {
      if (
        !window.confirm(
          `Utilisée par ${used.length} recette${used.length > 1 ? 's' : ''} : leurs apports et listes de courses vont changer.\n\n${used.map((u) => `– ${u.name}`).join('\n')}\n\nLa liste de courses en cours (et une période rouverte) est recalculée ; les listes précédentes déjà fermées ne changent pas.`,
        )
      )
        return;
      body.confirmed = true;
    }
    void props
      .run(() =>
        props.prep
          ? module.api.put(`/preps/${props.prep.id}`, body)
          : module.api.post('/preps', body),
      )
      .then((ok) => ok && props.onDone());
  };
  return (
    <Card title={props.prep ? `Modifier « ${props.prep.name} »` : 'Nouvelle préparation'}>
      <div className="cs-form">
        <input
          className="input"
          value={name}
          placeholder="Nom de la préparation (ex. Riz cuit, Sauce bolognaise)"
          aria-label="Nom de la préparation"
          onChange={(e) => setName(e.target.value)}
        />
        <h4>Composition pour une portion</h4>
        {lines.map((l, i) => (
          <IngredientRow
            key={l.key}
            line={l}
            ingredients={props.state.ingredients}
            onChange={(next) => setLines(lines.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setLines(lines.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          className="cs-link small"
          onClick={() =>
            setLines([
              ...lines,
              { kind: 'ingredient', key: newKey(), ingredientId: '', name: '', qty: '', unit: 'g' },
            ])
          }
        >
          + Ajouter un ingrédient
        </button>
        <KeepFields
          value={keep}
          onChange={setKeep}
          legend="Conservation une fois préparée (facultatif, pour le batch cooking) — c’est toi qui la renseignes, l’app ne la vérifie pas"
        />
        <textarea
          className="input"
          rows={2}
          value={note}
          placeholder="Note (facultatif)"
          aria-label="Note"
          onChange={(e) => setNote(e.target.value)}
        />
        {props.prep && props.prep.usedBy.length > 0 && (
          <p className="small muted">
            {usedText(props.prep)}. Changer sa composition change leurs apports et leurs listes de
            courses (confirmation demandée).
          </p>
        )}
        <div className="ui-actions">
          <Button
            disabled={!name.trim() || lines.some((l) => l.name.trim() && !(parseQty(l.qty) > 0))}
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
