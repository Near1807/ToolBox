import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

/** Desktop window buttons; nothing in a browser (dev UI on localhost:5173). */
const desktop = typeof window !== 'undefined' ? window.toolbox?.window : undefined;

/** Full-screen state of the desktop window, kept in sync with F11 and the buttons. */
export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    void desktop.isFullscreen().then(setFullscreen);
    return desktop.onFullscreenChange(setFullscreen);
  }, []);
  return fullscreen;
}

/** Sidebar button: switches the window to full screen and back (also F11). */
export function FullscreenButton({ fullscreen }: { fullscreen: boolean }) {
  if (!desktop) return null;
  return (
    <button type="button" className="nav-link nav-link--button" onClick={desktop.toggleFullscreen}>
      {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      <span className="nav-link__label">
        {fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
      </span>
      <kbd className="nav-link__key">F11</kbd>
    </button>
  );
}

/** In full screen, the app draws its own window buttons in the top-right corner. */
export function WindowButtons({ fullscreen }: { fullscreen: boolean }) {
  if (!desktop || !fullscreen) return null;
  return (
    <div className="window-buttons" role="toolbar" aria-label="Fenêtre">
      <button type="button" title="Réduire" aria-label="Réduire" onClick={desktop.minimize}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5h8" />
        </svg>
      </button>
      <button
        type="button"
        title="Quitter le plein écran (F11)"
        aria-label="Quitter le plein écran"
        onClick={desktop.toggleFullscreen}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M4 1v3H1M6 1v3h3M4 9V6H1M6 9V6h3" />
        </svg>
      </button>
      <button
        type="button"
        className="window-buttons__close"
        title="Fermer ToolBox"
        aria-label="Fermer ToolBox"
        onClick={desktop.close}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1l-8 8" />
        </svg>
      </button>
    </div>
  );
}
