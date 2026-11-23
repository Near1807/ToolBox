// v0.46.0: the disk's witness at the top of the Coffre's pages — « Disque
// branché », « Disque absent · dernière mise à jour il y a 3 jours », « 12
// éléments seulement sur ce PC » — and, disk plugged in, what an update would
// do (the update itself is always a click).
import type { ReactNode } from 'react';
import { Icon } from '@hub/sdk/frontend';
import type { DiskStatusDto } from '../../shared/types';
import { ago, plural } from './useDisk';

export function witnessText(s: DiskStatusDto): { tone: 'on' | 'off' | 'warn'; text: string } {
  if (!s.disk)
    return {
      tone: s.pending ? 'warn' : 'off',
      text: s.pending
        ? `Aucun disque du coffre : ${plural(s.pending, 'élément')} sans sauvegarde`
        : 'Aucun disque du coffre',
    };
  const pending = s.pending ? ` · ${plural(s.pending, 'élément')} seulement sur ce PC` : '';
  return s.connected
    ? { tone: 'on', text: `Disque « ${s.disk.name} » branché${pending}` }
    : {
        tone: s.pending ? 'warn' : 'off',
        text: `Disque absent · dernière mise à jour ${ago(s.lastUpdateAt)}${pending}`,
      };
}

/** « 12 à copier, 3 à mettre à jour, 2 à déplacer, 1 vers la corbeille ». */
export function countsText(c: DiskStatusDto['counts']): string {
  return [
    c.copy && `${c.copy} à copier`,
    c.update && `${c.update} à mettre à jour`,
    c.move && `${c.move} à déplacer`,
    c.trash && `${c.trash} vers la corbeille`,
  ]
    .filter(Boolean)
    .join(', ');
}

export function DiskWitness(props: { status: DiskStatusDto; action?: ReactNode }) {
  const s = props.status;
  const w = witnessText(s);
  const todo = s.connected ? countsText(s.counts) : '';
  return (
    <div
      className={`coffre-witness coffre-witness--${w.tone}${todo ? ' coffre-witness--todo' : ''}`}
      role="status"
    >
      <span className="coffre-witness__dot" aria-hidden="true" />
      <Icon name={s.connected ? 'disc' : 'warning'} />
      <span className="coffre-witness__text">{w.text}</span>
      {todo && <span className="coffre-witness__todo">{todo}</span>}
      {s.oldTrash > 0 && (
        <a className="coffre-witness__link" href="#/m/coffre/corbeille">
          {s.oldTrash} dans la corbeille du disque depuis plus de 30 jours
        </a>
      )}
      {props.action}
    </div>
  );
}
