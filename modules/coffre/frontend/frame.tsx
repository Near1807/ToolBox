// v0.45.0, v0.50.0: what every page of the Coffre shares — drop anywhere on
// the page (fenêtre de rangement; a folder arrives as it is), the message with
// « Annuler », the preview over the page, opening (an executable never without
// a confirmation naming it), a file's menu, « Nouveau dossier » / « Nouveau
// fichier… », the labels copied (Ctrl+Maj+C) and pasted (Ctrl+Maj+V).
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
import { isRunnable, runnableQuestion } from '@hub/sdk/core';
import {
  announceJobs,
  Button,
  errorMessage,
  formatBytes,
  getFilePath,
  type MenuItem,
  type ModuleContextValue,
  notifyDataChanged,
  pickFiles,
  pickFolder,
  runJob,
  UndoToast,
  useApi,
  useContextMenu,
  useModule,
  waitForJob,
} from '@hub/sdk/frontend';
import type {
  AnalyzeResultDto,
  DiskStatusDto,
  FolderDto,
  ItemDto,
  LabelValue,
  SetAsideDto,
} from '../shared/types';
import { Deposit } from './Deposit';
import { DiskWitness } from './disk/DiskWitness';
import { NewItemDialog, PasteLabelsDialog } from './NewItem';
import { CoffreTasks } from './Tasks';
import { UpdateDialog } from './disk/UpdateDialog';
import { VerifyDialog } from './disk/VerifyDialog';
import { useDisk } from './disk/useDisk';
import { entriesOf, openPlan, type DepositEntry } from './logic';
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
  folders: FolderDto[];
  values: Record<string, string[]>;
  tools: Tools;
  /** Every open screen of the Coffre reads its data again. */
  refresh(): void;
  /** Files or folders dropped (a DataTransfer); `fixed`: the folder they were dropped on. */
  drop(data: DataTransfer, fixed?: string | null): void;
  /** « Ranger des fichiers… »: the file picker, then the rangement window. */
  pick(fixed?: string | null): void;
  /** v0.50.0: « Ranger un dossier… »: the folder picker (it arrives as it is). */
  pickDir(fixed?: string | null): void;
  /** v0.50.0: « Nouveau dossier » / « Nouveau fichier… » in a folder (null: the top / À ranger). */
  create(kind: 'folder' | 'file', folderId: string | null): void;
  /** v0.50.0: the labels copied (Ctrl+Maj+C), or null. */
  copied: LabelValue[] | null;
  copyLabels(item: ItemDto): void;
  /** Pasted on these files: « Ajouter » or « Remplacer » asked first. */
  pasteLabels(items: ItemDto[], labels?: LabelValue[]): void;
  /** The files Ctrl+Maj+C / Ctrl+Maj+V act on (the card in focus, the selection, the preview). */
  setTargets(items: ItemDto[]): void;
  /** The folder of the page shown: what is dropped on the page goes there. */
  setHere(folderId: string | null): void;
  notify(message: string, undoId?: string | null): void;
  fail(error: unknown): void;
  /** v0.47.0: `locate`: opened from a search (its page, the words marked). */
  preview(items: ItemDto[], index: number, locate?: ReaderLocate): void;
  open(item: ItemDto, how?: OpenHow): void;
  /** v0.47.0: paths to put away (sent by Windows, new downloads): the rangement window. */
  range(paths: string[]): void;
  /** v0.47.0: « Lire en plein écran » — a reading window of its own (Alt+Tab). */
  readWindow(item: ItemDto): void;
  trash(item: ItemDto): void;
  pin(item: ItemDto): void;
  move(item: ItemDto, folderId: string | null): void;
  /** A file's menu (the same actions as elsewhere, ADR 0048). */
  menuOf(item: ItemDto, extra?: MenuItem[]): MenuItem[];
  bindMenu: ReturnType<typeof useContextMenu>['bind'];
  /** v0.46.0: the disk's status (null while it is read). */
  disk: DiskStatusDto | null;
  verify(): void;
  /** v0.48.0: the disk's update window (plan, update, eject), from the « Gestion » tab. */
  update(): void;
  archive(items: ItemDto[]): void;
  reactivate(item: ItemDto): void;
}

const Ctx = createContext<CoffreValue | null>(null);

interface AnalyzeOptions {
  files?: Map<string, File>;
  fixed?: string | null;
  /** v0.47.0: added to the rangement window already open (files sent a moment later). */
  append?: boolean;
  /** v0.49.0: beyond the threshold, « Continuer ». */
  confirmed?: boolean;
}

/** « node_modules (52 000 fichiers, 290 Mo), .venv (plus de 4 000 fichiers) ». */
export function setAsideText(list: readonly SetAsideDto[]): string {
  const shown = list
    .slice(0, 4)
    .map(
      (s) =>
        `${s.rel} (${s.partial ? 'plus de ' : ''}${s.files.toLocaleString('fr-FR')} fichiers${s.partial ? '' : `, ${formatBytes(s.bytes)}`})`,
    );
  return `${shown.join(', ')}${list.length > 4 ? ` et ${list.length - 4} autre(s)` : ''}`;
}

export function useCoffre(): CoffreValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCoffre() hors d’une page du Coffre');
  return value;
}

/** The paths and files of a drop. */
function droppedOf(data: DataTransfer) {
  const paths: string[] = [];
  const files = new Map<string, File>();
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
    if (!entry?.isDirectory) files.set(p, file);
  }
  return { paths, files, unknown };
}

/** Does a drag carry files (not a card of the page)? */
export const draggingFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

export function CoffreFrame(props: { children: ReactNode }) {
  const module = useModule();
  const menu = useContextMenu();
  const folders = useApi<FolderDto[]>(module.url('/folders'));
  const values = useApi<Record<string, string[]>>(module.url('/labels/values'));
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
  // v0.49.0: the disk's update waits for a deposit or an import; proposed once it is over.
  const waitsFor = disk.data?.waitsFor ?? null;
  const [waited, setWaited] = useState<string | null>(null);
  const [proposeUpdate, setProposeUpdate] = useState(false);
  if (waitsFor !== waited) {
    if (waited && !waitsFor) setProposeUpdate(true);
    setWaited(waitsFor);
  }
  const onDiskChanged = useCallback(() => {
    reloadDisk();
    notifyDataChanged([module.id]);
  }, [reloadDisk, module.id]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [entries, setEntries] = useState<DepositEntry[] | null>(null);
  const entriesOpen = useRef(false);
  useEffect(() => {
    entriesOpen.current = entries !== null;
  }, [entries]);
  const [creating, setCreating] = useState<{
    kind: 'folder' | 'file';
    folderId: string | null;
  } | null>(null);
  const [copied, setCopied] = useState<LabelValue[] | null>(null);
  const [pasting, setPasting] = useState<{ items: ItemDto[]; labels: LabelValue[] } | null>(null);
  const targets = useRef<ItemDto[]>([]);
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

  // v0.49.0: the analysis is a background task (the panel shows it; the page stays usable);
  // beyond the threshold it asks first.
  const [bigQuestion, setBigQuestion] = useState<{
    paths: string[];
    options: AnalyzeOptions;
    files: number;
    bytes: number;
    setAside: SetAsideDto[];
  } | null>(null);
  const analyze = useCallback(
    async (paths: string[], options: AnalyzeOptions) => {
      try {
        const { jobId } = await module.api.post<{ jobId: string }>('/deposit/analyze', {
          paths,
          folderId: options.fixed ?? null,
          confirmed: options.confirmed === true,
        });
        announceJobs();
        const job = await waitForJob(jobId);
        const r = job.result as AnalyzeResultDto | null;
        if (job.status === 'failed') throw new Error(job.error ?? 'Analyse impossible');
        if (!r || job.status !== 'succeeded') return;
        if (r.needsConfirm) {
          setBigQuestion({ paths, options, ...r.needsConfirm });
          return;
        }
        if ((job.details?.errorCount ?? 0) > 0)
          notify(
            `${job.details!.errorCount} élément(s) n’ont pas pu être analysés : la raison est dans le panneau des tâches.`,
          );
        if (!r.proposals.length) return;
        const made = entriesOf(r.proposals, options);
        setEntries((now) => (options.append && now ? [...now, ...made] : made));
      } catch (error) {
        fail(error);
      }
    },
    [module.api, fail, notify],
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
      void analyze(got.paths, { files: got.files, fixed });
    },
    [analyze, notify],
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

  const pickDir = useCallback(
    async (fixed: string | null = null) => {
      try {
        const dir = await pickFolder({ title: 'Ranger un dossier dans le Coffre (tel quel)' });
        if (dir) void analyze([dir], { fixed });
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

  const range = useCallback(
    (paths: string[]) => {
      if (paths.length) void analyze(paths, { append: entriesOpen.current });
    },
    [analyze],
  );

  const readWindow = useCallback(
    (item: ItemDto) => {
      module.api
        .post<{ opened: boolean; route: string }>(`/files/${item.id}/read-window`)
        .then((r) => {
          // Outside the desktop app (a browser in development): a tab.
          if (!r.opened) window.open(`#${r.route}`, '_blank', 'noopener');
        })
        .catch(fail);
    },
    [module.api, fail],
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
      // v0.47.1: a file of code goes to VS Code (else the preview), never to the
      // application Windows associates with it (which may run it).
      if (mode === 'app') {
        const plan = openPlan(item, t);
        if (plan.kind === 'preview') {
          setPreview({ items: [item], index: 0 });
          return;
        }
        if (plan.kind !== 'app') mode = plan.kind;
      }
      let runnable = false;
      if ((mode === 'app' || mode === 'readcopy') && isRunnable(item.name)) {
        // Règle 4: a program or a script is never launched without this question.
        if (!window.confirm(runnableQuestion(item.name))) return;
        runnable = true;
      }
      module.api.post(`/files/${item.id}/open`, { how: mode, runnable }).catch(fail);
    },
    [module.api, t, fail, notify, diskName],
  );

  /** Archive (confirmed, with the room freed): the PC's copy removed after both are read again. */
  const archive = useCallback(
    (list: ItemDto[]) => {
      const ok = list.filter((i) => i.diskState === 'active');
      if (!ok.length) {
        notify(
          'Rien à archiver : seulement un fichier déjà sur le disque (mets le disque à jour d’abord).',
        );
        return;
      }
      const freed = ok.reduce((sum, i) => sum + i.size, 0);
      if (
        !window.confirm(
          `Archiver ${ok.length > 1 ? `ces ${ok.length} fichiers` : `« ${ok[0]!.name} »`} ?

Ils restent sur le disque « ${diskName} » (vérifiés avant), et leur copie est retirée de ce PC : ${formatBytes(freed)} libérés. Ils restent visibles et trouvables ici ; pour les modifier, il faudra les réactiver (disque branché).`,
        )
      )
        return;
      // v0.49.0: a background task (the panel shows it; each refusal in its report).
      runJob<{ archived: number; freed: number; refused: { name: string; reason: string }[] }>(
        module.api.post('/files/archive', { ids: ok.map((i) => i.id), confirm: true }),
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
      runJob(module.api.post(`/files/${item.id}/reactivate`))
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
        .delete<{ undoId: string }>(`/files/${item.id}`)
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
      module.api.patch(`/files/${item.id}`, { pinned: !item.pinned }).then(refresh).catch(fail);
    },
    [module.api, refresh, fail],
  );
  const list = useMemo(() => folders.data ?? [], [folders.data]);
  const move = useCallback(
    (item: ItemDto, folderId: string | null) => {
      module.api
        .patch<{ undoId: string }>(`/files/${item.id}`, folderId ? { folderId } : { later: true })
        .then((r) => {
          const where = folderId
            ? (list.find((c) => c.id === folderId)?.path.join(' › ') ?? '')
            : 'À ranger';
          notify(`« ${item.name} » est maintenant dans ${where}.`, r.undoId);
          refresh();
        })
        .catch(fail);
    },
    [module.api, list, notify, refresh, fail],
  );

  const copyLabels = useCallback(
    (item: ItemDto) => {
      if (!item.labels.length) {
        notify(`« ${item.name} » n’a pas d’étiquette à copier.`);
        return;
      }
      setCopied(item.labels.map((l) => ({ family: l.family, value: l.value })));
      notify(
        `${item.labels.length} étiquette${item.labels.length > 1 ? 's' : ''} copiée${item.labels.length > 1 ? 's' : ''} : Ctrl+Maj+V pour les coller.`,
      );
    },
    [notify],
  );

  const menuOf = useCallback(
    (item: ItemDto, extra: MenuItem[] = []): MenuItem[] => [
      { title: item.name },
      {
        label: item.folderId === null ? 'Ranger…' : 'Route et étiquettes…',
        icon: 'pencil',
        shortcut: 'Espace',
        onSelect: () => setPreview({ items: [item], index: 0 }),
      },
      {
        label: 'Copier les étiquettes',
        icon: 'copy',
        shortcut: 'Ctrl+Maj+C',
        disabled: item.labels.length ? false : 'Aucune étiquette',
        onSelect: () => copyLabels(item),
      },
      {
        label: 'Coller les étiquettes…',
        icon: 'copy',
        shortcut: 'Ctrl+Maj+V',
        disabled: copied ? false : 'Copie d’abord les étiquettes d’un fichier',
        onSelect: () => copied && setPasting({ items: [item], labels: copied }),
      },
      {
        label: 'Changer de dossier',
        icon: 'folder-input',
        disabled: item.inProject
          ? 'Un projet se déplace avec son dossier (indivisible) : depuis la carte ou l’arbre'
          : false,
        submenu: [
          ...[...list]
            .filter((c) => !c.project)
            .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), 'fr'))
            .map((c) => ({
              label: c.path.join(' › '),
              disabled: c.id === item.folderId ? 'Il y est déjà' : false,
              onSelect: () => move(item, c.id),
            })),
          { separator: true as const },
          {
            label: 'À ranger (plus tard)',
            disabled: item.folderId === null ? 'Il y est déjà' : false,
            onSelect: () => move(item, null),
          },
        ],
      },
      {
        label: item.pinned ? 'Retirer de « En cours »' : 'Épingler dans « En cours »',
        icon: 'star',
        onSelect: () => pin(item),
      },
      ...(item.diskState === 'archived'
        ? [
            {
              label: 'Réactiver (recopier sur le PC)',
              icon: 'upload' as const,
              disabled: disk.data?.connected ? false : `Branche le disque « ${diskName} »`,
              onSelect: () => reactivate(item),
            },
          ]
        : !item.trashedAt
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
      ...(item.kind === 'file' && !item.trashedAt
        ? [
            {
              label: 'Lire en plein écran',
              icon: 'eye' as const,
              onSelect: () => readWindow(item),
            },
          ]
        : []),
      {
        label: {
          vscode: 'Ouvrir dans VS Code',
          preview: 'Aperçu (code : jamais lancé)',
          folder: 'Afficher le dossier',
          app: 'Ouvrir avec l’application',
        }[openPlan(item, t).kind],
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
        label: item.kind === 'project' ? 'Supprimer le projet (entier)' : 'Supprimer',
        icon: 'trash',
        danger: true,
        confirm: `Mettre « ${item.name} » dans la corbeille du Coffre${item.kind === 'project' ? ' (le projet entier, indivisible)' : ''} ?\n\nTu pourras le récupérer (ou « Annuler » juste après).`,
        onSelect: () => trash(item),
      },
    ],
    [
      copied,
      copyLabels,
      readWindow,
      list,
      move,
      pin,
      open,
      trash,
      t,
      disk.data,
      diskName,
      archive,
      reactivate,
    ],
  );

  // v0.47.0: Ctrl+K is the hub's search (everywhere, the Coffre's content included).
  // v0.50.0: Ctrl+Maj+C copies the labels of the file in focus (or previewed), Ctrl+Maj+V
  // pastes them on the selection (or the file in focus) — « Ajouter » or « Remplacer ».
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'c' && k !== 'v') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const list = targets.current;
      if (!list.length) return;
      e.preventDefault();
      if (k === 'c') copyLabels(list[0]!);
      else if (copied) setPasting({ items: list, labels: copied });
      else notify('Copie d’abord les étiquettes d’un fichier (Ctrl+Maj+C).');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [copied, copyLabels, notify]);

  const value = useMemo<CoffreValue>(
    () => ({
      api: module.api,
      path: module.path,
      folders: list,
      values: values.data ?? {},
      tools: t,
      refresh,
      drop,
      pick: (fixed) => void pick(fixed ?? here.current),
      pickDir: (fixed) => void pickDir(fixed ?? here.current),
      create: (kind, folderId) => setCreating({ kind, folderId }),
      copied,
      copyLabels,
      pasteLabels: (items, labels) => {
        const list = labels ?? copied;
        if (!list) {
          notify('Copie d’abord les étiquettes d’un fichier (Ctrl+Maj+C).');
          return;
        }
        if (items.length) setPasting({ items, labels: list });
      },
      setTargets: (items) => {
        targets.current = items;
      },
      setHere: (id) => {
        here.current = id;
      },
      notify,
      fail,
      preview: (items, index, locate) => setPreview({ items, index, locate }),
      open,
      readWindow,
      range,
      trash,
      pin,
      move,
      menuOf,
      bindMenu: menu.bind,
      disk: disk.data,
      verify: () => setVerifying(true),
      update: () => setUpdating(true),
      archive,
      reactivate,
    }),
    [
      readWindow,
      range,
      module,
      list,
      values.data,
      t,
      refresh,
      drop,
      pick,
      pickDir,
      copied,
      copyLabels,
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
          // A tile took it already (its own folder): the zone only closes.
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
                disk.data.refuses && disk.data.connected ? (
                  <Button small disabled title={disk.data.refuses} data-coffre-disk-refuses>
                    Mise à jour impossible pour l’instant
                  </Button>
                ) : disk.data.waitsFor && disk.data.connected && !disk.data.jobId ? (
                  <Button small disabled title={disk.data.waitsFor} data-coffre-disk-waits>
                    Import en cours : la mise à jour sera possible à la fin
                  </Button>
                ) : disk.data.jobId ? (
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
        {proposeUpdate && disk.data?.connected && !disk.data.waitsFor && (
          <div className="coffre-banner" role="status" data-coffre-propose-update>
            <span>L’import est terminé : tu peux maintenant mettre à jour le disque.</span>
            <span className="coffre-manage__buttons">
              <Button
                small
                onClick={() => {
                  setProposeUpdate(false);
                  setUpdating(true);
                }}
              >
                Mettre à jour le disque…
              </Button>
              <Button variant="secondary" small onClick={() => setProposeUpdate(false)}>
                Plus tard
              </Button>
            </span>
          </div>
        )}
        <CoffreTasks onFail={fail} />
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
      {bigQuestion && (
        <div className="coffre-modal" role="dialog" aria-modal="true" aria-label="Gros dépôt">
          <div className="coffre-modal__box coffre-question" data-coffre-big>
            <h2>C’est un gros dépôt</h2>
            <p>
              {bigQuestion.files.toLocaleString('fr-FR')} fichiers, {formatBytes(bigQuestion.bytes)}{' '}
              (après avoir écarté les dossiers recréables). Le ranger prendra du temps ; la page
              reste utilisable pendant ce temps.
            </p>
            {bigQuestion.setAside.length > 0 && (
              <p className="muted small">Déjà écartés : {setAsideText(bigQuestion.setAside)}.</p>
            )}
            <Button
              autoFocus
              onClick={() => {
                const q = bigQuestion;
                setBigQuestion(null);
                void analyze(q.paths, { ...q.options, confirmed: true });
              }}
            >
              Continuer
            </Button>
            <Button variant="secondary" onClick={() => setBigQuestion(null)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
      {entries && <Deposit entries={entries} onClose={() => setEntries(null)} />}
      {creating && (
        <NewItemDialog
          kind={creating.kind}
          folderId={creating.folderId}
          onClose={() => setCreating(null)}
        />
      )}
      {pasting && (
        <PasteLabelsDialog
          items={pasting.items}
          labels={pasting.labels}
          onClose={() => setPasting(null)}
        />
      )}
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
