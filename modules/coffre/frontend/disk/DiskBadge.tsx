// v0.46.0: the Coffre's entry in the sidebar — a dot: the disk is plugged in
// (accent), or something is kept on this PC only (warning), with its reason
// on hover. Nothing when all is saved and the disk is away.
import type { DiskStatusDto } from '../../shared/types';
import { ago, plural, useDisk } from './useDisk';

export function badgeOf(s: DiskStatusDto | null): { tone: 'on' | 'warn'; text: string } | null {
  if (!s) return null;
  if (!s.disk)
    return s.pending
      ? {
          tone: 'warn',
          text: `Aucun disque du coffre : ${plural(s.pending, 'élément')} sans sauvegarde`,
        }
      : null;
  if (s.connected) return { tone: 'on', text: `Disque « ${s.disk.name} » branché` };
  if (s.pending)
    return {
      tone: 'warn',
      text: `${plural(s.pending, 'élément')} seulement sur ce PC · dernière mise à jour ${ago(s.lastUpdateAt)}`,
    };
  return null;
}

export function DiskBadge() {
  const { data } = useDisk(10_000);
  const badge = badgeOf(data);
  if (!badge) return null;
  return (
    <span
      className={`coffre-badge coffre-badge--${badge.tone}`}
      title={badge.text}
      aria-label={badge.text}
      role="img"
    />
  );
}
