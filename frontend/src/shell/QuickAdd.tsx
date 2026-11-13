// The « Ajouter » bar of the PC shell (v0.36.0, ADR 0046): the « + » of the
// sidebar and a shortcut (Ctrl+N by default, Réglages › Apparence) open it;
// the bar itself is the SDK's (shared with the phone) and knows no module.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { QuickAddHost } from '@hub/sdk/quick-add';
import { shortcutOf } from '../themes/automation';
import { THEME_PREFS_EVENT } from './theme-automation';
import { loadUiPrefs } from './ui-prefs';

/** The « + » button (and anything else) opens the bar with this event. */
export const QUICK_ADD_EVENT = 'toolbox:quick-add';
export const DEFAULT_QUICK_ADD_SHORTCUT = 'Ctrl+N';

/** The shortcut chosen in Réglages › Apparence (Ctrl+N by default; empty: none). */
export function useQuickAddShortcut(): string {
  const [shortcut, setShortcut] = useState(DEFAULT_QUICK_ADD_SHORTCUT);
  useEffect(() => {
    const load = () =>
      loadUiPrefs()
        .then((p) => setShortcut(p.quickAddShortcut ?? DEFAULT_QUICK_ADD_SHORTCUT))
        .catch(() => undefined);
    load();
    window.addEventListener(THEME_PREFS_EVENT, load);
    return () => window.removeEventListener(THEME_PREFS_EVENT, load);
  }, []);
  return shortcut;
}

export function QuickAdd() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const shortcut = useQuickAddShortcut();
  useEffect(() => {
    const show = () => setOpen(true);
    const key = (event: KeyboardEvent) => {
      if (!shortcut || event.defaultPrevented || event.repeat) return;
      if (shortcutOf(event) !== shortcut) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener(QUICK_ADD_EVENT, show);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener(QUICK_ADD_EVENT, show);
      window.removeEventListener('keydown', key);
    };
  }, [shortcut]);
  return (
    <QuickAddHost open={open} onClose={() => setOpen(false)} navigate={(r) => void navigate(r)} />
  );
}
