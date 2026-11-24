// A list with a search to pick a value in one click (or create it: « Créer
// « … » »). Keyboard: ↑ ↓, Entrée, Échap (which never closes the window under it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { fold } from '../shared/deduce';

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

export function Picker(props: {
  label: string;
  options: PickerOption[];
  onPick: (value: string, created: boolean) => void;
  onClose: () => void;
  /** The line offered to create what was typed (none: no creation). */
  createLabel?: (text: string) => string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const { onClose, options, createLabel } = props;

  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const found = options.filter((o) => {
      const hay = fold(`${o.label} ${o.hint ?? ''}`);
      return words.every((w) => hay.includes(w));
    });
    const text = query.trim();
    const exact = found.some((o) => fold(o.label) === fold(text) || fold(o.value) === fold(text));
    const lines: (PickerOption & { created?: boolean })[] = found.slice(0, 60);
    if (text && !exact && createLabel)
      lines.push({ value: text, label: createLabel(text), created: true });
    return lines;
  }, [query, options, createLabel]);

  // A click outside closes it.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);

  const pick = (i: number) => {
    const line = shown[i];
    if (line) props.onPick(line.value, line.created === true);
  };

  return (
    <div className="coffre-picker" ref={box} role="dialog" aria-label={props.label}>
      <input
        autoFocus
        className="input"
        placeholder="Chercher ou écrire…"
        value={query}
        aria-label={props.label}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            pick(active);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <ul className="coffre-picker__list" role="listbox">
        {shown.map((o, i) => (
          <li
            key={`${o.created ? '+' : ''}${o.value}`}
            role="option"
            aria-selected={i === active}
            className={`coffre-picker__item${i === active ? ' coffre-picker__item--on' : ''}${o.created ? ' coffre-picker__item--new' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(i);
            }}
          >
            <span>{o.label}</span>
            {o.hint && <span className="coffre-picker__hint">{o.hint}</span>}
          </li>
        ))}
        {!shown.length && <li className="coffre-picker__empty">Rien ne correspond</li>}
      </ul>
    </div>
  );
}
