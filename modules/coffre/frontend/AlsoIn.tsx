// v0.46.0 I: « Aussi utilisé dans… » — an element lives in ONE context (its
// folder) and can be « aussi utilisé » in others: a link, never a copy. In the
// preview's sheet: the contexts, removable, and the list to add one.
import { useState } from 'react';
import { Icon } from '@hub/sdk/frontend';
import type { ItemDto } from '../shared/types';
import { useCoffre } from './frame';
import { Picker } from './Picker';
import { contextOptions } from './Sheet';

export function AlsoIn(props: { item: ItemDto; onChanged: () => void }) {
  const coffre = useCoffre();
  const [picking, setPicking] = useState(false);
  const { item } = props;
  const byId = new Map(coffre.contexts.map((c) => [c.id, c]));
  const change = (run: () => Promise<unknown>) =>
    run()
      .then(() => {
        props.onChanged();
        coffre.refresh();
      })
      .catch(coffre.fail);
  return (
    <div className="coffre-sheet__row">
      <span className="coffre-sheet__label">Aussi dans</span>
      <div className="coffre-sheet__value">
        {item.alsoIn.map((id) => (
          <span key={id} className="coffre-value">
            <span className="coffre-value__text">
              {byId.get(id)?.path.join(' › ') ?? 'contexte disparu'}
            </span>
            <button
              type="button"
              className="coffre-value__remove"
              aria-label="Retirer ce contexte"
              title="Retirer (le fichier ne bouge pas)"
              onClick={() => void change(() => coffre.api.delete(`/items/${item.id}/also/${id}`))}
            >
              <Icon name="close" />
            </button>
          </span>
        ))}
        <button
          type="button"
          className="coffre-sheet__pick coffre-sheet__pick--empty"
          title="Le montrer aussi dans un autre contexte (un lien, jamais une copie)"
          onClick={() => setPicking(true)}
        >
          + Aussi utilisé dans…
        </button>
        {picking && (
          <Picker
            label="Aussi utilisé dans"
            options={contextOptions(coffre.contexts).filter(
              (o) => o.value !== item.contextId && !item.alsoIn.includes(o.value),
            )}
            onClose={() => setPicking(false)}
            onPick={(contextId) => {
              setPicking(false);
              void change(() => coffre.api.post(`/items/${item.id}/also`, { contextId }));
            }}
          />
        )}
      </div>
    </div>
  );
}
