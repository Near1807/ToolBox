// « Aujourd'hui »: what goes out today and what is late, ready to publish:
// file to drag into Instagram, caption to copy, « Publié » to tick.
import { useState } from 'react';
import { ErrorMessage, errorMessage, useModule } from '@hub/sdk/frontend';
import { longDate, shortDate } from './dates';
import { CopyCaption, DragPreview, PlatformIcon, StatusBadge, trackColor } from './ItemParts';
import type { PlannerItem } from './types';

export function TodayRow(props: {
  item: PlannerItem;
  onOpen?: () => void;
  onChanged: () => void;
  showDate?: boolean;
}) {
  const module = useModule();
  const { item } = props;
  const [error, setError] = useState<string | null>(null);
  const toggle = async (published: boolean) => {
    setError(null);
    try {
      await module.api.post(`/items/${item.id}/published`, { published });
      props.onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <li className="rp-today__row" style={{ borderLeftColor: trackColor(item.colorIndex) }}>
      <DragPreview item={item} />
      <div className="rp-today__text">
        <div>
          <PlatformIcon kind={item.kind} /> <strong>{item.label}</strong> — {item.trackTitle}{' '}
          <span className="muted small">
            {props.showDate ? `${shortDate(item.date)} ` : ''}
            {item.time}
          </span>
        </div>
        <StatusBadge item={item} />
        {item.warning && <div className="small rp-text-warning">{item.warning}</div>}
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
      <div className="rp-today__actions">
        {item.platform === 'instagram' && item.caption && <CopyCaption text={item.caption} />}
        {item.platform === 'instagram' && (
          <label className="rp-check">
            <input
              type="checkbox"
              checked={item.status === 'published'}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Publié
          </label>
        )}
        {item.status === 'to-schedule' && item.youtube && (
          <a
            className="button button--secondary button--small"
            href={item.youtube.studioUrl}
            target="_blank"
            rel="noreferrer"
          >
            Programmer dans Studio ↗
          </a>
        )}
        {props.onOpen && (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={props.onOpen}
          >
            Détails
          </button>
        )}
      </div>
    </li>
  );
}

export function TodayView(props: {
  date: string;
  today: PlannerItem[];
  late: PlannerItem[];
  onOpen: (item: PlannerItem) => void;
  onChanged: () => void;
}) {
  return (
    <section className="card rp-today">
      <div className="card__header">
        <h2>Aujourd’hui — {longDate(props.date)}</h2>
      </div>
      {props.today.length === 0 && props.late.length === 0 && (
        <p className="muted">Rien à publier aujourd’hui.</p>
      )}
      {props.today.length > 0 && (
        <ul className="rp-today__list">
          {props.today.map((item) => (
            <TodayRow
              key={item.id}
              item={item}
              onOpen={() => props.onOpen(item)}
              onChanged={props.onChanged}
            />
          ))}
        </ul>
      )}
      {props.late.length > 0 && (
        <>
          <h3 className="rp-text-danger">En retard</h3>
          <ul className="rp-today__list">
            {props.late.map((item) => (
              <TodayRow
                key={item.id}
                item={item}
                showDate
                onOpen={() => props.onOpen(item)}
                onChanged={props.onChanged}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
