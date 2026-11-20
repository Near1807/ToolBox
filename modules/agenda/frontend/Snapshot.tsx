// v0.44.0 (Expérimental, ADR 0050): « Copier l'image » — a picture of the
// view shown (week, month, the phone's day) to send (« voilà mes dispos »).
// PC: into the system's clipboard (Ctrl+V in a chat); phone: Android's share
// sheet. Its small menu: « Détails / Dispos seulement », « Thème clair /
// thème de l'app » (both kept on this device), « Enregistrer l'image… ».
// Nothing is written in the data: no « Annuler ».
import { useState } from 'react';
import { bytesToBase64 } from '@hub/sdk/core';
import {
  copyImage,
  errorMessage,
  Icon,
  type MenuItem,
  onPhone,
  useContextMenu,
  useModule,
} from '@hub/sdk/frontend';
import type { SnapshotMode, SnapshotView } from '../shared/snapshot';
import { snapshotFileName } from '../shared/snapshot';
import type { RangeDto } from '../shared/types';
import { snapshotPeriod, snapshotPng, type SnapshotTheme } from './snapshot';

const PREFS_KEY = 'toolbox.agenda.snapshot';

interface Prefs {
  mode: SnapshotMode;
  theme: SnapshotTheme;
}

/** The last choices of this device (a local setting, never synchronised). */
function readPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return {
      mode: v?.mode === 'busy' ? 'busy' : 'details',
      theme: v?.theme === 'app' ? 'app' : 'light',
    };
  } catch {
    return { mode: 'details', theme: 'light' };
  }
}

/** « de la semaine », « du mois », « du jour ». */
const ofThe = (view: SnapshotView) =>
  view === 'week' ? 'de la semaine' : view === 'month' ? 'du mois' : 'du jour';
/** « cette semaine », « ce mois », « ce jour ». */
const thisOne = (view: SnapshotView) =>
  view === 'week' ? 'cette semaine' : view === 'month' ? 'ce mois' : 'ce jour';

export function useSnapshot(props: {
  data: RangeDto | null;
  view: SnapshotView | null;
  day: string;
  shown: (category: string) => boolean;
  /** What happened (the page's notice; nothing to undo). */
  onNotice: (message: string) => void;
}) {
  const module = useModule();
  const phone = onPhone();
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const [busy, setBusy] = useState(false);
  const setPrefs = (next: Prefs) => {
    setPrefsState(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Not kept: the default comes back next time.
    }
  };

  const make = (view: SnapshotView) =>
    snapshotPng({
      data: props.data!,
      view,
      day: props.day,
      mode: prefs.mode,
      theme: prefs.theme,
      shown: props.shown,
    });

  /** The phone's share sheet, or « Enregistrer sous » (ctx.files.saveAs, through the module). */
  const saveAs = async (view: SnapshotView, title: string) => {
    const { png } = await make(view);
    const period = snapshotPeriod(view, props.day);
    return module.api.post<{ path?: string; cancelled?: true }>('/image/save', {
      name: snapshotFileName(view, period.from, period.month),
      title,
      png: bytesToBase64(png),
    });
  };

  const run = (task: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    task()
      .then((message) => message && props.onNotice(message))
      .catch((e: unknown) => props.onNotice(`L’image n’a pas pu être créée : ${errorMessage(e)}`))
      .finally(() => setBusy(false));
  };

  /** The button: the clipboard (PC) or the share sheet (phone). */
  const copy = () => {
    const view = props.view;
    if (!view || !props.data) return;
    run(async () => {
      if (phone) {
        const r = await saveAs(view, `Partager l’image ${ofThe(view)}`);
        return r.cancelled ? null : `Image ${ofThe(view)} partagée`;
      }
      const { png } = await make(view);
      return (await copyImage(png))
        ? `Image ${ofThe(view)} copiée : colle-la dans ta discussion (Ctrl+V)`
        : 'L’image n’a pas pu être copiée dans le presse-papiers.';
    });
  };

  const save = () => {
    const view = props.view;
    if (!view || !props.data) return;
    run(async () => {
      const r = await saveAs(view, 'Enregistrer l’image');
      return r.cancelled ? null : `Image enregistrée${r.path ? ` : ${r.path}` : ''}`;
    });
  };

  /** Its menu (the options, and « Enregistrer l'image… »). */
  const items = (): MenuItem[] => [
    { title: 'Image (Expérimental)' },
    {
      label: 'Détails',
      icon: prefs.mode === 'details' ? 'check' : undefined,
      onSelect: () => setPrefs({ ...prefs, mode: 'details' }),
    },
    {
      label: 'Dispos seulement',
      icon: prefs.mode === 'busy' ? 'check' : undefined,
      onSelect: () => setPrefs({ ...prefs, mode: 'busy' }),
    },
    { separator: true },
    {
      label: 'Thème clair',
      icon: prefs.theme === 'light' ? 'check' : undefined,
      onSelect: () => setPrefs({ ...prefs, theme: 'light' }),
    },
    {
      label: 'Thème de l’app',
      icon: prefs.theme === 'app' ? 'check' : undefined,
      onSelect: () => setPrefs({ ...prefs, theme: 'app' }),
    },
    { separator: true },
    { label: 'Enregistrer l’image…', icon: 'download', onSelect: save },
  ];

  /** The action as a right-click menu item (the grid's background). */
  const menuItem = (view: SnapshotView): MenuItem => ({
    label: phone ? `Partager l’image de ${thisOne(view)}` : `Copier l’image de ${thisOne(view)}`,
    icon: 'image',
    onSelect: copy,
  });

  return { prefs, busy, copy, save, items, menuItem, phone };
}

/** The button and its small menu, in the Agenda's bar. */
export function SnapshotButton(props: {
  snapshot: ReturnType<typeof useSnapshot>;
  view: SnapshotView;
}) {
  const { snapshot, view } = props;
  const menu = useContextMenu();
  const label = snapshot.phone
    ? `Partager une image de ${thisOne(view)}`
    : `Copier une image de ${thisOne(view)}`;
  return (
    <span className="ag-snapshot">
      <button
        type="button"
        className="button button--secondary button--small ag-snapshot__copy"
        title={`${label} (Expérimental)`}
        aria-label={label}
        disabled={snapshot.busy}
        onClick={snapshot.copy}
      >
        <Icon name={snapshot.phone ? 'share' : 'image'} />
      </button>
      <button
        type="button"
        className="button button--secondary button--small ag-snapshot__more"
        title="Options de l’image"
        aria-label="Options de l’image"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          menu.openAt(snapshot.items, r.left, r.bottom + 4, 'Options de l’image');
        }}
      >
        <Icon name="chevron-down" />
      </button>
      {!snapshot.phone && (
        <span className="badge badge--warning ag-snapshot__badge">Expérimental</span>
      )}
      {menu.node}
    </span>
  );
}
