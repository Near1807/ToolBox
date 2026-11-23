// v0.46.0: the disk's status, read again every few seconds (the backend looks
// for the disk itself, read only: this only asks it what it saw).
import { useEffect } from 'react';
import { useApi, useModule } from '@hub/sdk/frontend';
import type { DiskStatusDto } from '../../shared/types';

export function useDisk(everyMs = 4000) {
  const module = useModule();
  const state = useApi<DiskStatusDto>(module.url('/disk'));
  const { reload } = state;
  useEffect(() => {
    const timer = setInterval(reload, everyMs);
    return () => clearInterval(timer);
  }, [reload, everyMs]);
  return state;
}

/** « il y a 3 jours », « il y a 2 h », « à l'instant ». */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'jamais';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 2) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

/** « 12 éléments », « 1 élément ». */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
