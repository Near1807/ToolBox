// v0.48.0, v0.50.0 (Expérimental): the actions on the folders, the same in
// the compact tree, on the map and in a folder's view (buttons, right click
// with the common menu, drag and drop): new folder / sub-folder, new file,
// rename, move into…, merge with…, delete (only empty: otherwise « Déplacer
// son contenu vers… » first), move up / down, the badges « Fin de route » and
// « Projet », archive / reactivate. Each one gives an « Annuler » where it can
// (ADR 0064, 0067). A move by dragging is always confirmed first. A Projet is
// indivisible: moved, archived, deleted whole, never merged.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button, type MenuItem, runJob } from '@hub/sdk/frontend';
import { invalidName } from '../shared/names';
import { routeLabel, subtreeOf, type RoutePick } from '../shared/route';
import type { FolderDto } from '../shared/types';
import { useCoffre } from './frame';
import { RoutePicker } from './RoutePicker';

type Dialog =
  | { kind: 'name'; title: string; initial: string; run: (name: string) => Promise<void> }
  | { kind: 'move'; folder: FolderDto }
  | { kind: 'merge'; folder: FolderDto; emptying: boolean }
  | { kind: 'confirm'; text: string; ok: string; run: () => Promise<void> };

/** The siblings of a folder, in the tree's order. */
export function siblingsOf(folders: readonly FolderDto[], parentId: string | null): FolderDto[] {
  return folders.filter((c) => c.parentId === parentId).sort(treeOrder);
}

/** The tree's order: the order set by hand, then the names. */
export function treeOrder(a: FolderDto, b: FolderDto): number {
  const sa = a.sort ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sort ?? Number.MAX_SAFE_INTEGER;
  return sa - sb || a.name.localeCompare(b.name, 'fr');
}

/** A move (from the map or the tree) can be dropped there? Null, or why not. */
export function moveRefusal(
  folders: readonly FolderDto[],
  src: FolderDto,
  dstId: string | null,
): string | null {
  if (dstId && subtreeOf(src.id, folders).has(dstId))
    return `« ${src.name} » ne peut pas aller dans lui-même ni dans un de ses sous-dossiers`;
  if (src.parentId === dstId) return `« ${src.name} » y est déjà`;
  return null;
}

export function useTreeActions() {
  const coffre = useCoffre();
  const { api, folders, notify, fail, refresh } = coffre;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const byId = useMemo(() => new Map(folders.map((c) => [c.id, c])), [folders]);

  const done = useCallback(
    (message: string, undoId?: string | null) => {
      notify(message, undoId ?? null);
      refresh();
    },
    [notify, refresh],
  );

  const create = useCallback(
    (parent: FolderDto | null) =>
      setDialog({
        kind: 'name',
        title: parent ? `Nouveau sous-dossier dans « ${parent.name} »` : 'Nouveau dossier',
        initial: '',
        run: async (name) => {
          const r = await api.post<FolderDto & { undoId?: string }>('/folders', {
            name,
            parentId: parent?.id ?? null,
          });
          done(`Dossier « ${routeLabel(r.path)} » créé.`, r.undoId);
        },
      }),
    [api, done],
  );

  const rename = useCallback(
    (c: FolderDto) =>
      setDialog({
        kind: 'name',
        title: `Renommer « ${c.name} » (son dossier suit)`,
        initial: c.name,
        run: async (name) => {
          if (name === c.name) return;
          const r = await api.patch<FolderDto & { undoId?: string }>(`/folders/${c.id}`, {
            name,
          });
          done(`Dossier renommé en « ${r.name} ».`, r.undoId);
        },
      }),
    [api, done],
  );

  /** Moves now (after a confirmation when it comes from a drag). */
  const moveTo = useCallback(
    async (c: FolderDto, pick: RoutePick) => {
      const body =
        pick.kind === 'existing'
          ? { parentId: pick.id }
          : pick.kind === 'new'
            ? { newParent: pick.path }
            : { parentId: null };
      const where =
        pick.kind === 'existing'
          ? `« ${routeLabel(byId.get(pick.id)?.path ?? [])} »`
          : pick.kind === 'new'
            ? `« ${routeLabel(pick.path)} » (nouveau)`
            : 'la racine';
      const r = await runJob<{ undoId: string }>(
        api.post<{ jobId: string }>(`/folders/${c.id}/move`, body),
      );
      done(`« ${c.name} » déplacé dans ${where} : ses fichiers ont suivi.`, r.undoId);
    },
    [api, byId, done],
  );

  /** A drag ended on another folder (or the root): asked first. */
  const requestMove = useCallback(
    (srcId: string, dstId: string | null) => {
      const src = byId.get(srcId);
      if (!src) return;
      const refusal = moveRefusal(folders, src, dstId);
      if (refusal) {
        notify(refusal);
        return;
      }
      const dst = dstId ? byId.get(dstId) : null;
      setDialog({
        kind: 'confirm',
        text: dst
          ? `Déplacer « ${src.name} » dans « ${dst.name} » ?`
          : `Déplacer « ${src.name} » à la racine ?`,
        ok: 'Déplacer',
        run: () => moveTo(src, dst ? { kind: 'existing', id: dst.id } : { kind: 'root' }),
      });
    },
    [byId, folders, moveTo, notify],
  );

  const reorder = useCallback(
    async (c: FolderDto, delta: -1 | 1) => {
      const list = siblingsOf(folders, c.parentId);
      const at = list.findIndex((x) => x.id === c.id);
      const target = at + delta;
      if (at < 0 || target < 0 || target >= list.length) return;
      // « Before » the one at the new place (moving down: the one after it).
      const before = delta < 0 ? list[target]!.id : (list[target + 1]?.id ?? null);
      try {
        const r = await api.post<{ undoId: string }>(`/folders/${c.id}/reorder`, {
          beforeId: before,
        });
        done(`« ${c.name} » ${delta < 0 ? 'monté' : 'descendu'}.`, r.undoId);
      } catch (e) {
        fail(e);
      }
    },
    [api, folders, done, fail],
  );

  const remove = useCallback(
    async (c: FolderDto) => {
      try {
        // A project goes to the Recycle Bin whole (indivisible), confirmed.
        if (c.project) {
          setDialog({
            kind: 'confirm',
            text: `Mettre le projet « ${c.name} » dans la corbeille du Coffre (entier) ?`,
            ok: 'Supprimer le projet',
            run: async () => {
              const r = await api.delete<{ undoId: string }>(`/folders/${c.id}/project`);
              done(`Projet « ${c.name} » dans la corbeille du Coffre.`, r.undoId);
            },
          });
          return;
        }
        const content = await api.get<{ items: number; children: number }>(
          `/folders/${c.id}/content`,
        );
        if (content.items || content.children) {
          setDialog({ kind: 'merge', folder: c, emptying: true });
          return;
        }
        setDialog({
          kind: 'confirm',
          text: `Supprimer le dossier vide « ${c.name} » ?`,
          ok: 'Supprimer',
          run: async () => {
            const r = await api.delete<{ undoId: string }>(`/folders/${c.id}`);
            done(`Dossier « ${c.name} » supprimé (il était vide).`, r.undoId);
          },
        });
      } catch (e) {
        fail(e);
      }
    },
    [api, done, fail],
  );

  /** « Fin de route » / « Projet » posed or taken off: nothing moves on the PC (« Annuler »). */
  const badge = useCallback(
    (c: FolderDto, kind: 'end' | 'project', on: boolean) =>
      void api
        .post<FolderDto & { undoId?: string }>(`/folders/${c.id}/${kind}`, { on })
        .then((r) =>
          done(
            `« ${c.name} » ${on ? 'est' : 'n’est plus'} ${kind === 'project' ? 'un projet' : 'une fin de route'}.`,
            r.undoId,
          ),
        )
        .catch(fail),
    [api, done, fail],
  );
  /** Archive a folder (its files; a project whole) or reactivate it: background tasks. */
  const archiveFolder = useCallback(
    (c: FolderDto) => {
      if (
        !window.confirm(
          `Archiver « ${c.name} »${c.project ? ' (le projet entier)' : ' (ses fichiers déjà sur le disque)'} ?\n\nIls restent sur le disque (vérifiés avant), leur copie est retirée de ce PC. Pour les modifier : les réactiver (disque branché).`,
        )
      )
        return;
      runJob<{ archived: number }>(api.post('/files/archive', { folderId: c.id, confirm: true }))
        .then((r) => done(`${r.archived} archivé${r.archived > 1 ? 's' : ''} dans « ${c.name} ».`))
        .catch(fail);
    },
    [api, done, fail],
  );
  const reactivateFolder = useCallback(
    (c: FolderDto) =>
      runJob<{ done: number }>(api.post(`/folders/${c.id}/reactivate`))
        .then((r) => done(`${r.done} réactivé${r.done > 1 ? 's' : ''} dans « ${c.name} ».`))
        .catch(fail),
    [api, done, fail],
  );

  const menuOf = useCallback(
    (c: FolderDto, open?: () => void): MenuItem[] => {
      const list = siblingsOf(folders, c.parentId);
      const at = list.findIndex((x) => x.id === c.id);
      const disk = coffre.disk;
      const noDisk = !disk?.disk
        ? 'Aucun disque du coffre'
        : !disk.connected
          ? `Branche le disque « ${disk.disk.name} »`
          : false;
      return [
        { title: routeLabel(c.path) },
        ...(open ? [{ label: 'Ouvrir', icon: 'chevron-right' as const, onSelect: open }] : []),
        {
          label: 'Nouveau sous-dossier ici…',
          icon: 'folder-plus',
          disabled: c.project ? 'Un projet est indivisible : crée-le dans VS Code' : false,
          onSelect: () => coffre.create('folder', c.id),
        },
        {
          label: 'Nouveau fichier…',
          icon: 'file',
          disabled: c.project ? 'Un projet est indivisible : crée-le dans VS Code' : false,
          onSelect: () => coffre.create('file', c.id),
        },
        { separator: true },
        c.project
          ? {
              label: 'Enlever « Projet »',
              icon: 'package',
              onSelect: () => badge(c, 'project', false),
            }
          : {
              label: 'Marquer comme projet',
              icon: 'package',
              onSelect: () => badge(c, 'project', true),
            },
        ...(c.project
          ? []
          : [
              {
                label: c.endOfRoute ? 'Enlever « Fin de route »' : 'Marquer « Fin de route »',
                icon: 'tag' as const,
                onSelect: () => badge(c, 'end', !c.endOfRoute),
              },
            ]),
        { separator: true },
        { label: 'Renommer…', icon: 'pencil', shortcut: 'F2', onSelect: () => rename(c) },
        {
          label: 'Déplacer dans…',
          icon: 'move',
          onSelect: () => setDialog({ kind: 'move', folder: c }),
        },
        {
          label: 'Fusionner avec…',
          icon: 'folder-input',
          disabled: c.project ? 'Un projet ne se fusionne pas (indivisible)' : false,
          onSelect: () => setDialog({ kind: 'merge', folder: c, emptying: false }),
        },
        {
          label: c.project ? 'Archiver le projet (entier)' : 'Archiver le dossier',
          icon: 'disc',
          disabled: noDisk,
          onSelect: () => archiveFolder(c),
        },
        {
          label: 'Réactiver ce qui est archivé ici',
          icon: 'upload',
          disabled: noDisk,
          onSelect: () => void reactivateFolder(c),
        },
        { separator: true },
        {
          label: 'Monter',
          icon: 'arrow-up',
          shortcut: 'Alt+↑',
          disabled: at <= 0 ? 'Déjà le premier' : false,
          onSelect: () => void reorder(c, -1),
        },
        {
          label: 'Descendre',
          icon: 'arrow-down',
          shortcut: 'Alt+↓',
          disabled: at >= list.length - 1 ? 'Déjà le dernier' : false,
          onSelect: () => void reorder(c, 1),
        },
        { separator: true },
        {
          label: c.project ? 'Supprimer le projet (entier)…' : 'Supprimer…',
          icon: 'trash',
          shortcut: 'Suppr',
          onSelect: () => void remove(c),
        },
      ];
    },
    [folders, coffre, rename, reorder, remove, badge, archiveFolder, reactivateFolder],
  );

  const close = () => setDialog(null);
  const node: ReactNode = dialog && (
    <div className="coffre-modal" role="dialog" aria-modal="true" aria-label="Dossiers">
      <div className="coffre-modal__box coffre-question coffre-treedialog">
        {dialog.kind === 'name' && (
          <NameForm
            title={dialog.title}
            initial={dialog.initial}
            onCancel={close}
            onSubmit={(name) => {
              close();
              dialog.run(name).catch(fail);
            }}
          />
        )}
        {dialog.kind === 'confirm' && (
          <>
            <h2>{dialog.text}</h2>
            <p className="muted small">Ses fichiers suivent. Tu pourras annuler.</p>
            <div className="coffre-treedialog__buttons">
              <Button
                autoFocus
                onClick={() => {
                  close();
                  dialog.run().catch(fail);
                }}
              >
                {dialog.ok}
              </Button>
              <Button variant="secondary" onClick={close}>
                Annuler
              </Button>
            </div>
          </>
        )}
        {dialog.kind === 'move' && (
          <>
            <h2>Déplacer « {dialog.folder.name} » dans…</h2>
            <p className="muted small">
              Ses fichiers et ses sous-dossiers suivent. Une route nouvelle est créée au moment où
              tu la choisis.
            </p>
            <RoutePicker
              inline
              label="Déplacer dans"
              folders={folders}
              root={dialog.folder.parentId !== null}
              exclude={subtreeOf(dialog.folder.id, folders)}
              onClose={close}
              onPick={(pick) => {
                const c = dialog.folder;
                close();
                if (pick.kind === 'pending') return;
                if (pick.kind === 'existing' && pick.id === c.parentId) return;
                moveTo(c, pick).catch(fail);
              }}
            />
            <Button variant="secondary" onClick={close}>
              Fermer
            </Button>
          </>
        )}
        {dialog.kind === 'merge' && (
          <>
            <h2>
              {dialog.emptying
                ? `« ${dialog.folder.name} » n’est pas vide : déplacer son contenu vers…`
                : `Fusionner « ${dialog.folder.name} » avec…`}
            </h2>
            <p className="muted small">
              Ses fichiers et ses sous-dossiers passent dans le dossier choisi (même nom : fusionnés
              ; jamais d’écrasement, « nom (2) »). Puis « {dialog.folder.name} » disparaît. Rien
              n’est supprimé.
            </p>
            <RoutePicker
              inline
              label="Fusionner avec"
              folders={folders}
              allowNew={false}
              exclude={subtreeOf(dialog.folder.id, folders)}
              onClose={close}
              onPick={(pick) => {
                const c = dialog.folder;
                if (pick.kind !== 'existing') return;
                const into = byId.get(pick.id);
                setDialog({
                  kind: 'confirm',
                  text: `Fusionner « ${c.name} » dans « ${into ? routeLabel(into.path) : ''} » ?`,
                  ok: 'Fusionner',
                  run: async () => {
                    const r = await runJob<{ undoId: string }>(
                      api.post<{ jobId: string }>(`/folders/${c.id}/merge`, { into: pick.id }),
                    );
                    done(`« ${c.name} » fusionné dans « ${into?.name ?? ''} ».`, r.undoId);
                  },
                });
              }}
            />
            <Button variant="secondary" onClick={close}>
              Fermer
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return {
    menuOf,
    create,
    rename,
    remove,
    reorder,
    requestMove,
    moveTo,
    node,
    busy: dialog !== null,
  };
}

/** A folder's name: checked as typed (a folder name Windows accepts, exactly). */
function NameForm(props: {
  title: string;
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial);
  const clean = name.replace(/\s+/g, ' ').trim();
  const error = clean ? invalidName(clean) : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (clean && !error) props.onSubmit(clean);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onCancel();
        }
      }}
    >
      <h2>{props.title}</h2>
      <input
        autoFocus
        className="input"
        aria-label="Nom du dossier"
        aria-invalid={Boolean(error)}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
      />
      {error && <p className="coffre-route__error">{error}</p>}
      <div className="coffre-treedialog__buttons">
        <Button type="submit" disabled={!clean || Boolean(error)}>
          Valider
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
