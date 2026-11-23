// v0.45.0: what every page of the Coffre shares — drop anywhere on the page
// (fenêtre de rangement), the message with « Annuler », the preview over the
// page, opening (an executable never without a confirmation naming it), the
// context menu of an element, Ctrl+K (the Coffre's search, before the
// sidebar's while a Coffre page is open).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { isRunnable } from '@hub/sdk/core';
import {
  Button,
  errorMessage,
  formatBytes,
  getFilePath,
  notifyDataChanged,
  pickFiles,
  pickFolder,
  UndoToast,
  useApi,
  useContextMenu,
  useModule,
  type MenuItem,
  type ModuleContextValue,
} from '@hub/sdk/frontend';
import type { ContextDto, DiskStatusDto, ItemDto, ProposalDto } from '../shared/types';
import { Deposit } from './Deposit';
import { DiskWitness } from './disk/DiskWitness';
import { UpdateDialog } from './disk/UpdateDialog';
import { VerifyDialog } from './disk/VerifyDialog';
import { useDisk } from './disk/useDisk';
import { entriesOf, type DepositEntry } from './logic';
import { Preview } from './Preview';
import type { ReaderLocate } from './readers';

export interface Tools {
  vscode: boolean;
  animations: boolean;
  root: string;
}

interface Notice {
  message: string;
  undoId: string | null;
  key: number;
}

/** How an element opens (« readcopy »: an archived one, as a read-only copy). */
export type OpenHow = 'app' | 'folder' | 'vscode' | 'readcopy';

export interface CoffreValue {
  api: ModuleContextValue['api'];
  path: (page?: string) => string;
  contexts: ContextDto[];
  values: Record<string, string[]>;
  tools: Tools;
  /** Every open screen of the Coffre reads its data again. */
  refresh(): void;
  /** Files dropped (a DataTransfer); `fixed`: the context they were dropped on. */
  drop(data: DataTransfer, fixed?: string | null): void;
  addLink(kind: 'file' | 'folder'): void;
  /** « Ranger des fichiers… »: the file picker, then the rangement window. */
  pick(fixed?: string | null): void;
  /** The context of the page shown: what is dropped on the page goes there. */
  setHere(contextId: string | null): void;
  notify(message: string, undoId?: string | null): void;
  fail(error: unknown): void;
  /** v0.47.0: `locate`: opened from a search (its page, the words marked). */
  preview(items: ItemDto[], index: number, locate?: ReaderLocate): void;
  open(item: ItemDto, how?: OpenHow): void;
  trash(item: ItemDto): void;
  pin(item: ItemDto): void;
  move(item: ItemDto, contextId: string | null): void;
  /** The context menu of an element (the same actions as elsewhere, ADR 0048). */
  menuOf(item: ItemDto, extra?: MenuItem[]): MenuItem[];
  bindMenu: ReturnType<typeof useContextMenu>['bind'];
  /** v0.46.0: the disk's status (null while it is read). */
  disk: DiskStatusDto | null;
  verify(): void;
  archive(items: ItemDto[]): void;
  reactivate(item: ItemDto): void;
}

const Ctx = createContext<CoffreValue | null>(null);

export function useCoffre(): CoffreValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCoffre() hors d’une page du Coffre');
  return value;
}

/** The paths and files of a drop, and how many are folders. */
function droppedOf(data: DataTransfer) {
  const paths: string[] = [];
  const files = new Map<string, File>();
  let folders = 0;
  let unknown = 0;
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    const entry = item.webkitGetAsEntry?.();
    if (!file) continue;
    const p = getFilePath(file);
    if (!p) {
      unknown++;
      continue;
    }
    paths.push(p);
    if (entry?.isDirectory) folders++;
    else files.set(p, file);
  }
  return { paths, files, folders, unknown };
}

/** Does a drag carry files (not a card of the page)? */
export const draggingFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

export function CoffreFrame(props: { children: ReactNode }) {
  const module = useModule();
  const menu = useContextMenu();
  const contexts = useApi<ContextDto[]>(module.url('/contexts'));
  const values = useApi<Record<string, string[]>>(module.url('/values'));
  const tools = useApi<Tools>(module.url('/tools'));
  const disk = useDisk();
  const diskName = disk.data?.disk?.name ?? 'du coffre';
  const [archivedChoice, setArchivedChoice] = useState<ItemDto | null>(null);
  // Plugged in or unplugged: the pages read their elements again (an archived one opens or not).
  const connected = disk.data?.connected ?? null;
  const connectedRef = useRef<boolean | null>(connected);
  useEffect(() => {
    if (connectedRef.current !== null && connected !== null && connected !== connectedRef.current)
      notifyDataChanged([module.id]);
    connectedRef.current = connected;
  }, [connected, module.id]);
  const [verifying, setVerifying] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { reload: reloadDisk } = disk;
  const onDiskChanged = useCallback(() => {
    reloadDisk();
    notifyDataChanged([module.id]);
  }, [reloadDisk, module.id]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [entries, setEntries] = useState<DepositEntry[] | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [folderQuestion, setFolderQuestion] = useState<{
    paths: string[];
    files: Map<string, File>;
    fixed: string | null;
    folders: number;
  } | null>(null);
  const [preview, setPreview] = useState<{
    items: ItemDto[];
    index: number;
    locate?: ReaderLocate;
  } | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const here = useRef<string | null>(null);

  const refresh = useCallback(() => notifyDataChanged([module.id]), [module.id]);
  const notify = useCallback(
    (message: string, undoId: string | null = null) =>
      setNotice({ message, undoId, key: Date.now() }),
    [],
  );
  const fail = useCallback((error: unknown) => notify(errorMessage(error)), [notify]);

  const analyze = useCallback(
    async (
      paths: string[],
      options: { expand?: boolean; files?: Map<string, File>; fixed?: string | null; as?: 'link' },
    ) => {
      setAnalyzing(paths.length > 1 ? `${paths.length} éléments` : 'le fichier');
      try {
        const proposals = await module.api.post<ProposalDto[]>('/deposit/analyze', {
          paths,
          expand: options.expand === true,
        });
        setEntries(entriesOf(proposals, options));
      } catch (error) {
        fail(error);
      } finally {
        setAnalyzing(null);
      }
    },
    [module.api, fail],
  );

  const drop = useCallback(
    (data: DataTransfer, fixed: string | null = null) => {
      const got = droppedOf(data);
      if (!got.paths.length) {
        notify(
          got.unknown
            ? 'Glisser depuis l’Explorateur ne marche que dans l’application ToolBox (pas dans un navigateur).'
            : 'Rien à ranger dans ce que tu as glissé.',
        );
        return;
      }
      if (got.folders) setFolderQuestion({ ...got, fixed });
      else void analyze(got.paths, { files: got.files, fixed });
    },
    [analyze, notify],
  );

  const addLink = useCallback(
    async (kind: 'file' | 'folder') => {
      try {
        const paths =
          kind === 'file'
            ? await pickFiles({
                title: 'Lien externe : choisir un ou plusieurs fichiers',
                multiple: true,
              })
            : [await pickFolder({ title: 'Lien externe : choisir un dossier' })].filter(
                (p): p is string => Boolean(p),
              );
        if (paths.length) void analyze(paths, { as: 'link' });
      } catch (error) {
        fail(error);
      }
    },
    [analyze, fail],
  );

  const pick = useCallback(
    async (fixed: string | null = null) => {
      try {
        const paths = await pickFiles({ title: 'Ranger dans le Coffre', multiple: true });
        if (paths.length) void analyze(paths, { fixed });
      } catch (error) {
        fail(error);
      }
    },
    [analyze, fail],
  );

  const t: Tools = useMemo(
    () => tools.data ?? { vscode: false, animations: true, root: '' },
    [tools.data],
  );

  const open = useCallback(
    (item: ItemDto, how: OpenHow = 'app') => {
      // v0.46.0: an archived element is on the disk only, and is not modified there.
      if (item.diskState === 'archived' && how !== 'folder') {
        if (item.unavailable || !connectedRef.current) {
          notify(`Branche le disque « ${diskName} » pour ouvrir « ${item.name} ».`);
          return;
        }
        if (how !== 'readcopy') {
          setArchivedChoice(item);
          return;
        }
      }
      let mode = how;
      if (mode === 'app' && item.kind === 'project') mode = t.vscode ? 'vscode' : 'folder';
      let runnable = false;
      if ((mode === 'app' || mode === 'readcopy') && isRunnable(item.name)) {
        // Règle 4: a program or a script is never launched without this question.
        if (
          !window.confirm(
            `« ${item.name} » est un programme ou un script : l’ouvrir le LANCE sur ce PC.\n\nLe lancer quand même ?`,
          )
        )
          return;
        runnable = true;
      }
      module.api.post(`/items/${item.id}/open`, { how: mode, runnable }).catch(fail);
    },
    [module.api, t.vscode, fail, notify, diskName],
  );

  /** Archive (confirmed, with the room freed): the PC's copy removed after both are read again. */
  const archive = useCallback(
    (list: ItemDto[]) => {
      const ok = list.filter((i) => i.diskState === 'active');
      if (!ok.length) {
        notify(
          'Rien à archiver : seulement un élément déjà sur le disque (mets le disque à jour d’abord).',
        );
        return;
      }
      const freed = ok.reduce((sum, i) => sum + i.size, 0);
      if (
        !window.confirm(
          `Archiver ${ok.length > 1 ? `ces ${ok.length} éléments` : `« ${ok[0]!.name} »`} ?

Ils restent sur le disque « ${diskName} » (vérifiés avant), et leur copie est retirée de ce PC : ${formatBytes(freed)} libérés. Leurs fiches restent ici ; pour les modifier, il faudra les réactiver (disque branché).`,
        )
      )
        return;
      module.api
        .post<{ archived: number; freed: number; refused: { name: string; reason: string }[] }>(
          '/items/archive',
          { ids: ok.map((i) => i.id), confirm: true },
        )
        .then((r) => {
          const refused = r.refused.length
            ? ` Pas archivé${r.refused.length > 1 ? 's' : ''} : ${r.refused.map((x) => `${x.name} (${x.reason})`).join(' ; ')}.`
            : '';
          notify(
            `${r.archived} archivé${r.archived > 1 ? 's' : ''}, ${formatBytes(r.freed)} libérés sur le PC.${refused}`,
          );
          refresh();
          disk.reload();
        })
        .catch(fail);
    },
    [module.api, notify, refresh, fail, diskName, disk],
  );
  const reactivate = useCallback(
    (item: ItemDto) => {
      module.api
        .post(`/items/${item.id}/reactivate`)
        .then(() => {
          notify(`« ${item.name} » est de nouveau sur le PC : modifiable.`);
          refresh();
          disk.reload();
        })
        .catch(fail);
    },
    [module.api, notify, refresh, fail, disk],
  );

  const trash = useCallback(
    (item: ItemDto) => {
      module.api
        .delete<{ undoId: string }>(`/items/${item.id}`)
        .then((r) => {
          notify(`« ${item.name} » est dans la corbeille du Coffre.`, r.undoId);
          refresh();
        })
        .catch(fail);
    },
    [module.api, notify, refresh, fail],
  );
  const pin = useCallback(
    (item: ItemDto) => {
      module.api.patch(`/items/${item.id}`, { pinned: !item.pinned }).then(refresh).catch(fail);
    },
    [module.api, refresh, fail],
  );
  const list = useMemo(() => contexts.data ?? [], [contexts.data]);
  const move = useCallback(
    (item: ItemDto, contextId: string | null) => {
      module.api
        .patch<{ undoId: string }>(
          `/items/${item.id}`,
          contextId ? { contextId } : { arrival: true },
        )
        .then((r) => {
          const where = contextId
            ? (list.find((c) => c.id === contextId)?.path.join(' › ') ?? '')
            : 'Arrivée';
          notify(`« ${item.name} » est maintenant dans ${where}.`, r.undoId);
          refresh();
        })
        .catch(fail);
    },
    [module.api, list, notify, refresh, fail],
  );

  const menuOf = useCallback(
    (item: ItemDto, extra: MenuItem[] = []): MenuItem[] => [
      { title: item.name },
      {
        label: item.arrival ? 'Ranger…' : 'Modifier la fiche…',
        icon: 'pencil',
        shortcut: 'Espace',
        onSelect: () => setPreview({ items: [item], index: 0 }),
      },
      {
        label: 'Changer de contexte',
        icon: 'folder-input',
        submenu: [
          ...[...list]
            .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), 'fr'))
            .map((c) => ({
              label: c.path.join(' › '),
              disabled: c.id === item.contextId ? 'Il y est déjà' : false,
              onSelect: () => move(item, c.id),
            })),
          { separator: true as const },
          {
            label: 'Arrivée (à ranger plus tard)',
            disabled: item.arrival ? 'Il y est déjà' : false,
            onSelect: () => move(item, null),
          },
        ],
      },
      {
        label: item.pinned ? 'Retirer de « En cours »' : 'Épingler dans « En cours »',
        icon: 'star',
        onSelect: () => pin(item),
      },
      ...(item.contextId && item.url && /^(png|jpe?g|webp|gif|avif)$/.test(item.ext)
        ? [
            {
              label: 'Utiliser comme couverture du contexte',
              icon: 'image' as const,
              onSelect: () => {
                module.api
                  .patch(`/contexts/${item.contextId}`, { coverItemId: item.id })
                  .then(refresh)
                  .catch(fail);
              },
            },
          ]
        : []),
      ...(item.diskState === 'archived'
        ? [
            {
              label: 'Réactiver (recopier sur le PC)',
              icon: 'upload' as const,
              disabled: disk.data?.connected ? false : `Branche le disque « ${diskName} »`,
              onSelect: () => reactivate(item),
            },
          ]
        : item.kind !== 'link' && !item.trashedAt
          ? [
              {
                label: `Archiver (libère ${formatBytes(item.size)} sur le PC)`,
                icon: 'disc' as const,
                disabled: !disk.data?.disk
                  ? 'Aucun disque du coffre'
                  : !disk.data.connected
                    ? `Branche le disque « ${diskName} »`
                    : item.diskState !== 'active'
                      ? 'Pas encore sur le disque : mets-le à jour d’abord'
                      : false,
                onSelect: () => archive([item]),
              },
            ]
          : []),
      ...extra,
      { separator: true },
      {
        label:
          item.kind === 'project' && t.vscode ? 'Ouvrir dans VS Code' : 'Ouvrir avec l’application',
        icon: 'external-link',
        shortcut: 'Double-clic',
        onSelect: () => open(item),
      },
      {
        label: 'Afficher dans l’explorateur',
        icon: 'folder',
        onSelect: () => open(item, 'folder'),
      },
      { separator: true },
      {
        label: 'Supprimer',
        icon: 'trash',
        danger: true,
        confirm: `Mettre « ${item.name} » dans la corbeille du Coffre ?\n\nTu pourras le récupérer (ou « Annuler » juste après).`,
        onSelect: () => trash(item),
      },
    ],
    [
      list,
      move,
      pin,
      open,
      trash,
      t.vscode,
      module.api,
      refresh,
      fail,
      disk.data,
      diskName,
      archive,
      reactivate,
    ],
  );

  // v0.47.0: Ctrl+K is the hub's search (everywhere, the Coffre's content included).

  const value = useMemo<CoffreValue>(
    () => ({
      api: module.api,
      path: module.path,
      contexts: list,
      values: values.data ?? {},
      tools: t,
      refresh,
      drop,
      addLink: (kind) => void addLink(kind),
      pick: (fixed) => void pick(fixed ?? here.current),
      setHere: (id) => {
        here.current = id;
      },
      notify,
      fail,
      preview: (items, index, locate) => setPreview({ items, index, locate }),
      open,
      trash,
      pin,
      move,
      menuOf,
      bindMenu: menu.bind,
      disk: disk.data,
      verify: () => setVerifying(true),
      archive,
      reactivate,
    }),
    [
      module,
      list,
      values.data,
      t,
      refresh,
      drop,
      addLink,
      pick,
      notify,
      fail,
      open,
      trash,
      pin,
      move,
      menuOf,
      menu.bind,
      archive,
      reactivate,
      disk.data,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      <div
        className={`coffre${over ? ' coffre--drop' : ''}`}
        onDragEnter={(e) => {
          if (!draggingFiles(e)) return;
          depth.current++;
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!draggingFiles(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        }}
        onDragOver={(e) => {
          if (!draggingFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          if (!draggingFiles(e)) return;
          // A tile took it already (its own context): the zone only closes.
          const taken = e.defaultPrevented;
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          if (!taken) drop(e.dataTransfer, here.current);
        }}
      >
        {disk.data && (
          <div className="coffre-diskbar">
            <DiskWitness
              status={disk.data}
              action={
                disk.data.jobId ? (
                  <Button small onClick={() => setUpdating(true)}>
                    Mise à jour en cours…
                  </Button>
                ) : disk.data.connected && Object.values(disk.data.counts).some((n) => n > 0) ? (
                  <Button small onClick={() => setUpdating(true)}>
                    Mettre à jour
                  </Button>
                ) : disk.data.connected ? (
                  <Button variant="secondary" small onClick={() => setUpdating(true)}>
                    Le disque est à jour
                  </Button>
                ) : null
              }
            />
          </div>
        )}
        {archivedChoice && (
          <div
            className="coffre-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Élément archivé"
          >
            <div className="coffre-modal__box coffre-question">
              <h2>« {archivedChoice.name} » est archivé</h2>
              <p className="muted">
                Il est sur le disque « {diskName} » seulement, et ne s'y modifie pas.
              </p>
              <Button
                autoFocus
                onClick={() => {
                  const it = archivedChoice;
                  setArchivedChoice(null);
                  reactivate(it);
                }}
              >
                Réactiver pour le modifier
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const it = archivedChoice;
                  setArchivedChoice(null);
                  open(it, 'readcopy');
                }}
              >
                Ouvrir une copie en lecture
              </Button>
              <Button variant="secondary" onClick={() => setArchivedChoice(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
        {verifying && (
          <VerifyDialog
            onClose={() => {
              setVerifying(false);
              disk.reload();
            }}
            onChanged={onDiskChanged}
            onUpdate={() => {
              setVerifying(false);
              setUpdating(true);
            }}
          />
        )}
        {updating && disk.data && (
          <UpdateDialog
            status={disk.data}
            onClose={() => {
              setUpdating(false);
              disk.reload();
            }}
            onChanged={onDiskChanged}
          />
        )}
        {props.children}
        {over && (
          <div className="coffre-dropzone" aria-hidden="true">
            <span>Dépose pour ranger dans le Coffre (l’original ne bouge pas)</span>
          </div>
        )}
      </div>
      {analyzing && (
        <div className="coffre-busy" role="status">
          Analyse de {analyzing}…
        </div>
      )}
      {folderQuestion && (
        <div className="coffre-modal" role="dialog" aria-modal="true" aria-label="Un dossier">
          <div className="coffre-modal__box coffre-question">
            <h2>
              {folderQuestion.folders > 1 ? `${folderQuestion.folders} dossiers` : 'Un dossier'} :
              comment le ranger ?
            </h2>
            <Button
              autoFocus
              onClick={() => {
                const q = folderQuestion;
                setFolderQuestion(null);
                void analyze(q.paths, { files: q.files, fixed: q.fixed });
              }}
            >
              Un projet (le dossier entier)
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const q = folderQuestion;
                setFolderQuestion(null);
                void analyze(q.paths, { expand: true, files: q.files, fixed: q.fixed });
              }}
            >
              Les fichiers un par un
            </Button>
            <Button variant="secondary" onClick={() => setFolderQuestion(null)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
      {entries && <Deposit entries={entries} onClose={() => setEntries(null)} />}
      {preview && (
        <Preview
          items={preview.items}
          index={preview.index}
          locate={preview.locate}
          onIndex={(index) => setPreview((p) => (p ? { ...p, index, locate: undefined } : p))}
          onClose={() => setPreview(null)}
        />
      )}
      {menu.node}
      {notice && (
        <div className="coffre-toast">
          {notice.undoId ? (
            <UndoToast
              key={notice.key}
              message={notice.message}
              onUndo={() =>
                module.api.post('/undo', { undoId: notice.undoId }).then(refresh).catch(fail)
              }
              onDismiss={() => setNotice(null)}
            />
          ) : (
            <div className="ui-undo" role="status" key={notice.key}>
              <span>{notice.message}</span>
              <Button variant="secondary" small onClick={() => setNotice(null)}>
                OK
              </Button>
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
