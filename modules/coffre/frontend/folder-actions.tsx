// v0.48.0 (Expérimental): the actions on the tree of the contexts, the same
// in the compact tree, on the map and on a context's page (buttons, right
// click with the common menu, drag and drop): new context / sub-context,
// rename, move into…, merge with…, delete (only empty: otherwise « Déplacer
// son contenu vers… » first), move up / down. Each one gives an « Annuler »
// (ADR 0064). A move by dragging is always confirmed first.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button, type MenuItem } from '@hub/sdk/frontend';
import { invalidName } from '../shared/names';
import { routeLabel, subtreeOf, type RoutePick } from '../shared/route';
import type { ContextDto } from '../shared/types';
import { useCoffre } from './frame';
import { RoutePicker } from './RoutePicker';
import { runTask } from './Tasks';

type Dialog =
  | { kind: 'name'; title: string; initial: string; run: (name: string) => Promise<void> }
  | { kind: 'move'; context: ContextDto }
  | { kind: 'merge'; context: ContextDto; emptying: boolean }
  | { kind: 'confirm'; text: string; ok: string; run: () => Promise<void> };

/** The siblings of a context, in the tree's order. */
export function siblingsOf(contexts: readonly ContextDto[], parentId: string | null): ContextDto[] {
  return contexts.filter((c) => c.parentId === parentId).sort(treeOrder);
}

/** The tree's order: the order set by hand, then the names. */
export function treeOrder(a: ContextDto, b: ContextDto): number {
  const sa = a.sort ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sort ?? Number.MAX_SAFE_INTEGER;
  return sa - sb || a.name.localeCompare(b.name, 'fr');
}

/** A move (from the map or the tree) can be dropped there? Null, or why not. */
export function moveRefusal(
  contexts: readonly ContextDto[],
  src: ContextDto,
  dstId: string | null,
): string | null {
  if (dstId && subtreeOf(src.id, contexts).has(dstId))
    return `« ${src.name} » ne peut pas aller dans lui-même ni dans un de ses sous-contextes`;
  if (src.parentId === dstId) return `« ${src.name} » y est déjà`;
  return null;
}

export function useTreeActions() {
  const coffre = useCoffre();
  const { api, contexts, notify, fail, refresh } = coffre;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const byId = useMemo(() => new Map(contexts.map((c) => [c.id, c])), [contexts]);

  const done = useCallback(
    (message: string, undoId?: string | null) => {
      notify(message, undoId ?? null);
      refresh();
    },
    [notify, refresh],
  );

  const create = useCallback(
    (parent: ContextDto | null) =>
      setDialog({
        kind: 'name',
        title: parent ? `Nouveau sous-contexte dans « ${parent.name} »` : 'Nouveau contexte',
        initial: '',
        run: async (name) => {
          const r = await api.post<ContextDto & { undoId?: string }>('/contexts', {
            name,
            parentId: parent?.id ?? null,
          });
          done(`Contexte « ${routeLabel(r.path)} » créé.`, r.undoId);
        },
      }),
    [api, done],
  );

  const rename = useCallback(
    (c: ContextDto) =>
      setDialog({
        kind: 'name',
        title: `Renommer « ${c.name} » (son dossier suit)`,
        initial: c.name,
        run: async (name) => {
          if (name === c.name) return;
          const r = await api.patch<ContextDto & { undoId?: string }>(`/contexts/${c.id}`, {
            name,
          });
          done(`Contexte renommé en « ${r.name} ».`, r.undoId);
        },
      }),
    [api, done],
  );

  /** Moves now (after a confirmation when it comes from a drag). */
  const moveTo = useCallback(
    async (c: ContextDto, pick: RoutePick) => {
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
      const r = await runTask<{ undoId: string }>(
        api.post<{ jobId: string }>(`/contexts/${c.id}/move`, body),
      );
      done(`« ${c.name} » déplacé dans ${where} : ses fichiers ont suivi.`, r.undoId);
    },
    [api, byId, done],
  );

  /** A drag ended on another context (or the root): asked first. */
  const requestMove = useCallback(
    (srcId: string, dstId: string | null) => {
      const src = byId.get(srcId);
      if (!src) return;
      const refusal = moveRefusal(contexts, src, dstId);
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
    [byId, contexts, moveTo, notify],
  );

  const reorder = useCallback(
    async (c: ContextDto, delta: -1 | 1) => {
      const list = siblingsOf(contexts, c.parentId);
      const at = list.findIndex((x) => x.id === c.id);
      const target = at + delta;
      if (at < 0 || target < 0 || target >= list.length) return;
      // « Before » the one at the new place (moving down: the one after it).
      const before = delta < 0 ? list[target]!.id : (list[target + 1]?.id ?? null);
      try {
        const r = await api.post<{ undoId: string }>(`/contexts/${c.id}/reorder`, {
          beforeId: before,
        });
        done(`« ${c.name} » ${delta < 0 ? 'monté' : 'descendu'}.`, r.undoId);
      } catch (e) {
        fail(e);
      }
    },
    [api, contexts, done, fail],
  );

  const remove = useCallback(
    async (c: ContextDto) => {
      try {
        const content = await api.get<{ items: number; links: number; children: number }>(
          `/contexts/${c.id}/content`,
        );
        if (content.items || content.links || content.children) {
          setDialog({ kind: 'merge', context: c, emptying: true });
          return;
        }
        setDialog({
          kind: 'confirm',
          text: `Supprimer le contexte vide « ${c.name} » ?`,
          ok: 'Supprimer',
          run: async () => {
            const r = await api.delete<{ undoId: string }>(`/contexts/${c.id}`);
            done(`Contexte « ${c.name} » supprimé (il était vide).`, r.undoId);
          },
        });
      } catch (e) {
        fail(e);
      }
    },
    [api, done, fail],
  );

  const menuOf = useCallback(
    (c: ContextDto, open?: () => void): MenuItem[] => {
      const list = siblingsOf(contexts, c.parentId);
      const at = list.findIndex((x) => x.id === c.id);
      return [
        { title: routeLabel(c.path) },
        ...(open ? [{ label: 'Ouvrir', icon: 'chevron-right' as const, onSelect: open }] : []),
        { label: 'Nouveau sous-contexte ici…', icon: 'folder-plus', onSelect: () => create(c) },
        { label: 'Renommer…', icon: 'pencil', shortcut: 'F2', onSelect: () => rename(c) },
        {
          label: 'Déplacer dans…',
          icon: 'move',
          onSelect: () => setDialog({ kind: 'move', context: c }),
        },
        {
          label: 'Fusionner avec…',
          icon: 'folder-input',
          onSelect: () => setDialog({ kind: 'merge', context: c, emptying: false }),
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
          label: 'Supprimer…',
          icon: 'trash',
          shortcut: 'Suppr',
          onSelect: () => void remove(c),
        },
      ];
    },
    [contexts, create, rename, reorder, remove],
  );

  const close = () => setDialog(null);
  const node: ReactNode = dialog && (
    <div className="coffre-modal" role="dialog" aria-modal="true" aria-label="Contextes">
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
            <h2>Déplacer « {dialog.context.name} » dans…</h2>
            <p className="muted small">
              Ses éléments et ses sous-contextes suivent, ses fichiers aussi. Une route nouvelle est
              créée au moment où tu la choisis.
            </p>
            <RoutePicker
              inline
              label="Déplacer dans"
              contexts={contexts}
              root={dialog.context.parentId !== null}
              exclude={subtreeOf(dialog.context.id, contexts)}
              onClose={close}
              onPick={(pick) => {
                const c = dialog.context;
                close();
                if (pick.kind === 'arrival') return;
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
                ? `« ${dialog.context.name} » n’est pas vide : déplacer son contenu vers…`
                : `Fusionner « ${dialog.context.name} » avec…`}
            </h2>
            <p className="muted small">
              Ses éléments et ses sous-contextes passent dans le contexte choisi (même nom :
              fusionnés ; jamais d’écrasement, « nom (2) »). Puis « {dialog.context.name} »
              disparaît. Rien n’est supprimé.
            </p>
            <RoutePicker
              inline
              label="Fusionner avec"
              contexts={contexts}
              allowNew={false}
              exclude={subtreeOf(dialog.context.id, contexts)}
              onClose={close}
              onPick={(pick) => {
                const c = dialog.context;
                if (pick.kind !== 'existing') return;
                const into = byId.get(pick.id);
                setDialog({
                  kind: 'confirm',
                  text: `Fusionner « ${c.name} » dans « ${into ? routeLabel(into.path) : ''} » ?`,
                  ok: 'Fusionner',
                  run: async () => {
                    const r = await runTask<{ undoId: string }>(
                      api.post<{ jobId: string }>(`/contexts/${c.id}/merge`, { into: pick.id }),
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

/** A context's name: checked as typed (a folder name Windows accepts, exactly). */
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
        aria-label="Nom du contexte"
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
