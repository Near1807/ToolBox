import { useEffect, useRef, type ReactNode } from 'react';

export type MenuEntry =
  | { label: ReactNode; onClick: () => void; disabled?: boolean; icon?: ReactNode }
  | { separator: true }
  | { title: string };

/** Small context menu at the mouse position; closes on click outside, Escape or scroll. */
export function ContextMenu(props: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof MouseEvent && ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', key);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  // Keep the menu inside the window.
  const left = Math.min(props.x, window.innerWidth - 230);
  const top = Math.min(props.y, window.innerHeight - 40 - props.entries.length * 32);

  return (
    <div ref={ref} className="ui-menu" role="menu" style={{ left, top: Math.max(8, top) }}>
      {props.entries.map((entry, index) => {
        if ('separator' in entry) return <hr key={index} />;
        if ('title' in entry) {
          return (
            <div key={index} className="ui-menu__title label">
              {entry.title}
            </div>
          );
        }
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onClick();
            }}
          >
            {entry.icon}
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
