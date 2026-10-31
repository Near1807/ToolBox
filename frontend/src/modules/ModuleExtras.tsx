import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary, FloatingProvider, ModuleProvider, Icon } from '@hub/sdk/frontend';
import { useModules } from './ModulesContext';

/**
 * `Background` components of the loaded modules, mounted once for the whole
 * session in the main window (microphone, playback…). They render nothing.
 */
export function ModuleBackgrounds() {
  const { modules } = useModules();
  return (
    <>
      {modules
        .filter((m) => m.status === 'loaded' && m.frontend?.Background)
        .map((m) => {
          const Background = m.frontend!.Background!;
          return (
            <ModuleProvider key={m.id} manifest={m.manifest}>
              <ErrorBoundary label={m.manifest.name} silent>
                <Background />
              </ErrorBoundary>
            </ModuleProvider>
          );
        })}
    </>
  );
}

/**
 * Route #/overlay: the one floating window of the hub (transparent, always on
 * top, over the application in use). The panels of all modules are stacked in
 * a column, so they never overlap; the window is told its size (that of the
 * content) and whether it must take the mouse or the keyboard. MODULES.md §5.16.
 */
export function OverlayPage() {
  const { modules } = useModules();
  const root = useRef<HTMLDivElement>(null);
  const needs = useRef(new Map<object, { interactive: boolean; focus: boolean }>());
  const sent = useRef('');
  const send = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const all = [...needs.current.values()];
    // Only the grip left: nothing to show.
    const empty = el.querySelectorAll(':scope > :not(.overlay__grip)').length === 0;
    const layout = {
      width: empty ? 0 : Math.ceil(rect.width),
      height: empty ? 0 : Math.ceil(rect.height),
      interactive: all.some((n) => n.interactive),
      focus: all.some((n) => n.focus),
    };
    const key = JSON.stringify(layout);
    if (key === sent.current) return;
    sent.current = key;
    window.toolbox?.overlay?.layout(layout);
  }, []);
  const report = useCallback(
    (id: object, need: { interactive: boolean; focus: boolean } | null) => {
      if (need) needs.current.set(id, need);
      else needs.current.delete(id);
      send();
    },
    [send],
  );
  const [locked, setLocked] = useState(true);
  useEffect(() => window.toolbox?.overlay?.onPrefs((prefs) => setLocked(prefs.locked)), []);
  useEffect(() => {
    document.documentElement.classList.add('overlay-window');
    const el = root.current;
    const observer = new ResizeObserver(() => send());
    const mutations = new MutationObserver(() => send());
    if (el) {
      observer.observe(el);
      mutations.observe(el, { childList: true, subtree: true });
    }
    return () => {
      observer.disconnect();
      mutations.disconnect();
      document.documentElement.classList.remove('overlay-window');
    };
  }, [send]);
  return (
    <FloatingProvider value={report}>
      <div className="overlay" ref={root}>
        {!locked && (
          // The handle is a native drag region: the system moves the window.
          // Its rim (not a drag region) sees the pointer coming, so that the
          // window takes the mouse in time.
          <div
            className="overlay__grip"
            onPointerEnter={() => window.toolbox?.overlay?.hover(true)}
          >
            <span
              className="overlay__grip-handle"
              title="Glisser pour déplacer (Réglages > Fenêtre flottante pour verrouiller)"
              aria-label="Déplacer la fenêtre flottante"
            >
              <Icon name="grip" size={14} />
            </span>
          </div>
        )}
        {modules
          .filter((m) => m.status === 'loaded' && m.frontend?.Overlay)
          .map((m) => {
            const Overlay = m.frontend!.Overlay!;
            return (
              <ModuleProvider key={m.id} manifest={m.manifest}>
                <ErrorBoundary label={m.manifest.name} silent retryMs={5000}>
                  <Overlay />
                </ErrorBoundary>
              </ModuleProvider>
            );
          })}
      </div>
    </FloatingProvider>
  );
}
