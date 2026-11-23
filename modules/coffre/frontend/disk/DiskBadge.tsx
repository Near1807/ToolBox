// v0.46.0: the Coffre's entry in the sidebar — a dot: the disk is plugged in
// (accent), or something is kept on this PC only (warning), with its reason
// on hover. Nothing when all is saved and the disk is away.
import type { DiskStatusDto } from '../../shared/types';
import { useDownloads } from '../Downloads';
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
  // v0.47.0: « 3 nouveaux téléchargements » (only when the watching is on).
  const downloads = useDownloads(10_000).data;
  const n = downloads?.enabled ? downloads.pending.length : 0;
  const count = n ? (
    <span
      className="coffre-badge-count"
      title={n > 1 ? `${n} nouveaux téléchargements à ranger` : '1 nouveau téléchargement à ranger'}
    >
      {n}
    </span>
  ) : null;
  if (!badge) return count;
  return (
    <>
      {count}
      <span
        className={`coffre-badge coffre-badge--${badge.tone}`}
        title={badge.text}
        aria-label={badge.text}
        role="img"
      />
    </>
  );
}
