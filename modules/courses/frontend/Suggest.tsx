// A text field with suggestions that scroll (replaces <datalist>, whose
// native list cannot be scrolled reliably and is cut off at 150 % scaling):
// filtered as you type (accents and case ignored), arrows to move, Entrée
// to take one, Échap to close. Typing anything else stays possible.
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { fold } from '../shared/quantities';

export function Suggest(props: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  /** When the field is left (after a choice too). */
  onCommit?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const box = useRef<HTMLUListElement>(null);
  const q = fold(props.value);
  const shown = props.options.filter((o) => fold(o).includes(q) && fold(o) !== q);
  const take = (value: string) => {
    props.onChange(value);
    setOpen(false);
    setActive(-1);
  };
  const move = (index: number) => {
    setActive(index);
    box.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open || shown.length === 0) {
      if (e.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      move(Math.max(0, Math.min(shown.length - 1, active + step)));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      take(shown[active]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };
  return (
    <span className={`cs-suggest ${props.className ?? ''}`}>
      <input
        className="input"
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={id}
        aria-autocomplete="list"
        onChange={(e) => {
          props.onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          setOpen(false);
          props.onCommit?.(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {open && shown.length > 0 && (
        <ul ref={box} id={id} className="cs-suggest__list" role="listbox">
          {shown.map((o, i) => (
            <li
              key={o}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'cs-suggest__item--active' : undefined}
              // Before the field's blur, so that the choice is taken.
              onMouseDown={(e) => {
                e.preventDefault();
                take(o);
                props.onCommit?.(o);
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
