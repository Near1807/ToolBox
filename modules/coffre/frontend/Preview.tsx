// v0.45.0: the large preview — over the page: the reader in the middle, the
// sheet on the side (changed at once, « Annuler » in the message); ← → the
// previous / next file, Échap (or Espace) closes. v0.50.0: labels; a
// project's content is indivisible (its route changes with its folder).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, formatBytes, Icon, useApi, useModule } from '@hub/sdk/frontend';
import type { LabelFamily, ItemDto } from '../shared/types';
import { useCoffre } from './frame';
import { extOfItem, openPlan, shortDate, type FolderChoice } from './logic';
import { iconOf, ReaderView } from './ReaderView';
import type { ReaderLocate } from './readers';
import { Sheet } from './Sheet';
import { Versions } from './disk/Versions';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable);

export function Preview(props: {
  items: ItemDto[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** v0.47.0: opened from a search (its page, the words marked). */
  locate?: ReaderLocate;
}) {
  const module = useModule();
  const coffre = useCoffre();
  const navigate = useNavigate();
  const base = props.items[props.index];
  // Read again after each change (the sheet shows what is stored).
  const fresh = useApi<ItemDto>(base ? module.url(`/files/${base.id}`) : null);
  const item = fresh.data?.id === base?.id ? fresh.data : base;
  const { onClose, onIndex, index, items } = props;
  // v0.46.0: seen (« pas ouverts depuis 6 mois » counts a look as an opening).
  const seenId = base?.id;
  useEffect(() => {
    if (seenId) void module.api.post(`/files/${seenId}/seen`).catch(() => undefined);
  }, [seenId, module.api]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.coffre-picker, .ui-menu')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (typing(e.target)) return;
      else if (e.key === ' ') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        onIndex(index - 1);
      } else if (e.key === 'ArrowRight' && index < items.length - 1) {
        e.preventDefault();
        onIndex(index + 1);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, onIndex, index, items.length]);

  const source = useMemo(
    () => (item ? { name: item.name, ext: extOfItem(item), size: item.size, url: item.url } : null),
    // The same file: the same source (the reader does not read it again).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item?.id, item?.url, item?.size],
  );
  // v0.50.0: Ctrl+Maj+C / Ctrl+Maj+V act on the file previewed.
  useEffect(() => {
    if (item) coffre.setTargets([item]);
  }, [item, coffre]);
  if (!item || !source) return null;

  const done = (r: { undoId?: string | null }, message: string) => {
    coffre.notify(message, r.undoId ?? null);
    coffre.refresh();
    fresh.reload();
  };
  const choice: FolderChoice = item.folderId
    ? { kind: 'existing', id: item.folderId, origin: 'chosen', reason: null }
    : null;
  const onChoice = (next: FolderChoice) => {
    const body =
      next === null
        ? { later: true }
        : next.kind === 'existing'
          ? { folderId: next.id }
          : { newFolder: next.path };
    coffre.api
      .patch<{ undoId: string }>(`/files/${item.id}`, body)
      .then((r) => done(r, `« ${item.name} » déplacé.`))
      .catch(coffre.fail);
  };
  const onValues = (key: LabelFamily, values: string[]) =>
    coffre.api
      .put<{ undoId: string }>(`/files/${item.id}/labels`, { family: key, values })
      .then((r) => done(r, 'Étiquettes modifiées.'))
      .catch(coffre.fail);
  const rename = (name: string) => {
    if (!name.trim() || name.trim() === item.name) return;
    coffre.api
      .patch<{ undoId: string }>(`/files/${item.id}`, { name })
      .then((r) => done(r, `Renommé en « ${name.trim()} ».`))
      .catch(coffre.fail);
  };

  return (
    <div
      className="coffre-preview"
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu de ${item.name}`}
    >
      <header className="coffre-preview__head">
        <div className="coffre-preview__title">
          <strong>{item.name}</strong>
          <span className="muted">
            {[
              item.folderPath?.join(' › ') ?? 'À ranger',
              formatBytes(item.size),
              shortDate(item.fileDate),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        {items.length > 1 && (
          <span className="coffre-preview__count">
            {index + 1} / {items.length}
          </span>
        )}
        {/* v0.47.1: code without VS Code: the preview is the opening (never run). */}
        {openPlan(item, coffre.tools).kind !== 'preview' && (
          <Button onClick={() => coffre.open(item)}>
            {openPlan(item, coffre.tools).kind === 'vscode' ? 'Ouvrir dans VS Code' : 'Ouvrir'}
          </Button>
        )}
        {item.kind === 'file' && (
          <Button variant="secondary" onClick={() => coffre.readWindow(item)}>
            Lire en plein écran
          </Button>
        )}
        <Button variant="secondary" onClick={() => coffre.open(item, 'folder')}>
          Afficher dans l’explorateur
        </Button>
        <button
          type="button"
          className="icon-button"
          aria-label="Fermer (Échap)"
          title="Fermer (Échap)"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="coffre-preview__body">
        <button
          type="button"
          className="coffre-preview__nav coffre-preview__nav--prev"
          aria-label="Précédent"
          disabled={index === 0}
          onClick={() => onIndex(index - 1)}
        >
          <Icon name="chevron-right" />
        </button>
        <div className="coffre-preview__reader">
          <ReaderView
            source={source}
            mode="full"
            locate={props.locate}
            icon={iconOf(item)}
            fallback={
              <>
                <p className="muted">
                  {item.unavailable
                    ? `Archivé : sur le disque « ${coffre.disk?.disk?.name ?? 'du coffre'} ». Branche-le pour le voir.`
                    : item.kind === 'project'
                      ? 'Un projet : ouvre son dossier pour le parcourir.'
                      : 'Pas d’aperçu pour ce type de fichier.'}
                </p>
                <Button onClick={() => coffre.open(item)}>
                  {item.kind === 'project' && coffre.tools.vscode
                    ? 'Ouvrir dans VS Code'
                    : 'Ouvrir dans son application'}
                </Button>
              </>
            }
          />
        </div>
        <button
          type="button"
          className="coffre-preview__nav"
          aria-label="Suivant"
          disabled={index >= items.length - 1}
          onClick={() => onIndex(index + 1)}
        >
          <Icon name="chevron-right" />
        </button>
        <aside className="coffre-preview__sheet">
          <Sheet
            choice={choice}
            onChoice={onChoice}
            routeLocked={
              item.inProject
                ? 'Un projet se déplace avec son dossier (indivisible) : depuis la carte ou l’arbre'
                : null
            }
            labels={item.labels}
            onValues={(key, values) => void onValues(key, values)}
            onShowAll={(key, value) => {
              onClose();
              navigate(module.path(`v/${key}/${encodeURIComponent(value)}`));
            }}
          >
            <NameField key={`${item.id}:${item.name}`} name={item.name} onRename={rename} />
            {item.originalName && (
              <p className="coffre-sheet__row muted small" data-coffre-original>
                <span className="coffre-sheet__label">Nom d’origine</span>
                <span className="coffre-sheet__value">{item.originalName}</span>
              </p>
            )}
          </Sheet>
          <Versions item={item} onRestored={() => fresh.reload()} />
          {item.sourcePath && (
            <p className="coffre-preview__origin muted" title={item.sourcePath}>
              Original : {item.sourcePath}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** The name, renamed when the field is left (Entrée too). */
function NameField(props: { name: string; onRename: (name: string) => void }) {
  const [name, setName] = useState(props.name);
  return (
    <label className="coffre-sheet__row">
      <span className="coffre-sheet__label">Nom</span>
      <input
        className="input coffre-sheet__name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => props.onRename(name)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}
