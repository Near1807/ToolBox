// Images the browser shows itself. v0.47.0: a zoom in the full reader
// (buttons, Ctrl + molette, a click: the real size ↔ the whole image).
import { useState, type WheelEvent } from 'react';
import { Button } from '@hub/sdk/frontend';
import { registerReader, type ReaderProps } from './registry';
import { useSourceUrl } from './useSource';

const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

function ImageReader({ source, mode }: ReaderProps) {
  const url = useSourceUrl(source);
  /** null: the whole image in the view; a number: that zoom of its real size. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  if (!url) return null;
  if (mode === 'thumb')
    return (
      <img
        className="coffre-reader-thumb-img"
        src={url}
        alt={source.name}
        loading="lazy"
        draggable={false}
      />
    );
  const step = (dir: 1 | -1) =>
    setZoom((z) => {
      const now = z ?? 1;
      return dir > 0
        ? (STEPS.find((s) => s > now + 0.001) ?? STEPS[STEPS.length - 1]!)
        : ([...STEPS].reverse().find((s) => s < now - 0.001) ?? STEPS[0]!);
    });
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    step(e.deltaY < 0 ? 1 : -1);
  };
  return (
    <div className="coffre-reader-image-wrap">
      <div className="coffre-reader-image-tools" role="toolbar" aria-label="Zoom">
        <button type="button" className="icon-button" aria-label="Réduire" onClick={() => step(-1)}>
          −
        </button>
        <span className="coffre-reader-pdf__pct">
          {zoom === null ? 'Ajusté' : `${Math.round(zoom * 100)} %`}
        </span>
        <button type="button" className="icon-button" aria-label="Agrandir" onClick={() => step(1)}>
          +
        </button>
        <Button variant="secondary" onClick={() => setZoom(null)} disabled={zoom === null}>
          Ajuster
        </Button>
        <Button variant="secondary" onClick={() => setZoom(1)} disabled={zoom === 1}>
          Taille réelle
        </Button>
        {natural && (
          <span className="muted">
            {natural.w} × {natural.h} px
          </span>
        )}
      </div>
      <div
        className={`coffre-reader-image-view${zoom === null ? '' : ' coffre-reader-image-view--zoomed'}`}
        onWheel={onWheel}
      >
        <img
          className="coffre-reader-image"
          src={url}
          alt={source.name}
          draggable={false}
          onLoad={(e) =>
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          onClick={() => setZoom((z) => (z === null ? 1 : null))}
          style={
            zoom !== null && natural
              ? {
                  width: natural.w * zoom,
                  height: natural.h * zoom,
                  maxWidth: 'none',
                  maxHeight: 'none',
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

registerReader({
  id: 'image',
  label: 'Image',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
  maxBytes: 80_000_000,
  thumbMaxBytes: 25_000_000,
  component: ImageReader,
});
