import { useEffect } from 'react';
import { ErrorBoundary, ModuleProvider } from '@hub/sdk/frontend';
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

/** Route #/overlay: the floating indicator window (transparent, always on top). */
export function OverlayPage() {
  const { modules } = useModules();
  useEffect(() => {
    document.documentElement.classList.add('overlay-window');
    return () => document.documentElement.classList.remove('overlay-window');
  }, []);
  return (
    <div className="overlay">
      {modules
        .filter((m) => m.status === 'loaded' && m.frontend?.Overlay)
        .map((m) => {
          const Overlay = m.frontend!.Overlay!;
          return (
            <ModuleProvider key={m.id} manifest={m.manifest}>
              <ErrorBoundary label={m.manifest.name} silent>
                <Overlay />
              </ErrorBoundary>
            </ModuleProvider>
          );
        })}
    </div>
  );
}
