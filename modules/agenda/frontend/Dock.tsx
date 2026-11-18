// v0.41.0: the sheet opens where one looks (PC). A click on a block opens its
// sheet (EventPanel, or the To-do's lent sheet) in a panel fixed on the right
// of the window, seen whatever the scroll; the week stays in view (the page
// leaves it the room). It closes with ×, Échap, or a click on the page out of
// it; the focus goes back to the block. A window under 900 px wide: the sheet
// opens in the page as before, the page scrolls to it, and back to the block
// once it is closed. The phone: unchanged.
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Icon, onPhone } from '@hub/sdk/frontend';

/** Under this width, no side panel: the sheet stays in the page. */
export const DOCK_MIN_WIDTH = 900;

const wideQuery = `(min-width: ${DOCK_MIN_WIDTH}px)`;
const subscribe = (change: () => void) => {
  const m = window.matchMedia(wideQuery);
  m.addEventListener('change', change);
  return () => m.removeEventListener('change', change);
};

/** The sheet goes in the side panel here (PC, window wide enough). */
export function useDocked(): boolean {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(wideQuery).matches,
    () => false,
  );
  return wide && !onPhone();
}

/** The sheet's close button: × on the PC (side panel), « Fermer » in the page and on the phone. */
export function SheetClose(props: { onClose: () => void }) {
  const docked = useDocked();
  return docked ? (
    <button
      type="button"
      className="icon-button"
      aria-label="Fermer (Échap)"
      title="Fermer (Échap)"
      onClick={props.onClose}
    >
      <Icon name="close" />
    </button>
  ) : (
    <Button small variant="secondary" onClick={props.onClose}>
      Fermer
    </Button>
  );
}

export function Dock(props: { label: string; onClose: () => void; children: ReactNode }) {
  const docked = useDocked();
  const ref = useRef<HTMLDivElement>(null);
  // What had the focus when it opened (the block clicked): where the focus and the eye go back.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  const onClose = useRef(props.onClose);
  useEffect(() => {
    onClose.current = props.onClose;
  });

  // Opened: the panel gets the focus (PC), or the page scrolls to the sheet (narrow window).
  useEffect(() => {
    const el = ref.current;
    if (docked) el?.focus({ preventScroll: true });
    else if (!onPhone()) el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return () => {
      if (!opener?.isConnected) return;
      if (docked) opener.focus({ preventScroll: true });
      else if (!onPhone()) opener.scrollIntoView({ block: 'center' });
    };
  }, [docked, opener]);

  // Échap, or a click on the page out of the panel (not in a dialog or a message over it).
  useEffect(() => {
    if (!docked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose.current();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || ref.current?.contains(t)) return;
      if (t.closest('main')) onClose.current();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [docked]);

  if (onPhone()) return <>{props.children}</>;
  return docked ? (
    <div ref={ref} className="ag-dock" role="dialog" aria-label={props.label} tabIndex={-1}>
      {props.children}
    </div>
  ) : (
    <div ref={ref} className="ag-dock-inline" tabIndex={-1}>
      {props.children}
    </div>
  );
}
