import type { ReactNode } from 'react';

/** Circular progress (0…1), drawn clockwise from the top; colours from the theme. */
export function Ring(props: {
  progress: number;
  size: number;
  tone: 'work' | 'break' | 'idle';
  children?: ReactNode;
}) {
  const stroke = Math.max(8, Math.round(props.size / 20));
  const r = (props.size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, props.progress));
  return (
    <div className="tm-ring" style={{ width: props.size, height: props.size }}>
      <svg
        width={props.size}
        height={props.size}
        viewBox={`0 0 ${props.size} ${props.size}`}
        aria-hidden
      >
        <circle
          className="tm-ring__track"
          cx={props.size / 2}
          cy={props.size / 2}
          r={r}
          strokeWidth={stroke}
        />
        <circle
          className={`tm-ring__arc tm-ring__arc--${props.tone}`}
          cx={props.size / 2}
          cy={props.size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          transform={`rotate(-90 ${props.size / 2} ${props.size / 2})`}
        />
      </svg>
      <div className="tm-ring__center">{props.children}</div>
    </div>
  );
}
