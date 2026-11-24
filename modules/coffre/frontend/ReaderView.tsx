// A source shown by its reader (registry), or its icon when no reader takes it.
import { Component, type ReactNode } from 'react';
import { Icon, type IconName } from '@hub/sdk/frontend';
import type { ItemDto } from '../shared/types';
import { readerFor, type ReaderLocate, type ReaderSource } from './readers';

/** The icon of an element without a preview (by its nature). */
export function iconOf(item: Pick<ItemDto, 'kind' | 'attributes'>): IconName {
  if (item.kind === 'project') return 'folder';
  if (item.kind === 'link') return 'external-link';
  const nature = item.attributes.find((a) => a.key === 'nature')?.value;
  const icons: Record<string, IconName> = {
    image: 'image',
    vidéo: 'film',
    son: 'waveform',
    tableur: 'grid',
    présentation: 'clapperboard',
    archive: 'package',
    note: 'notebook',
    code: 'keyboard',
    programme: 'warning',
    "fichier d'application": 'puzzle',
  };
  return (nature && icons[nature]) || 'file';
}

/** A reader that breaks shows the icon (never a broken page). */
class Guard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ReaderView(props: {
  source: ReaderSource;
  mode: 'full' | 'thumb';
  icon: IconName;
  /** Under the icon when there is no reader (« Ouvrir dans l'application »). */
  fallback?: ReactNode;
  /** v0.47.0: opened from a search (its page, the words marked). */
  locate?: ReaderLocate;
  /** v0.47.0: in the reading window. */
  window?: boolean;
}) {
  const reader = readerFor(props.source, props.mode);
  const icon = (
    <div className={props.mode === 'thumb' ? 'coffre-reader-icon' : 'coffre-reader-none'}>
      <Icon name={props.icon} />
      {props.mode === 'full' && props.fallback}
    </div>
  );
  if (!reader) return icon;
  const Reader = reader.component;
  return (
    <Guard key={`${reader.id}:${props.source.url ?? props.source.name}`} fallback={icon}>
      <Reader source={props.source} mode={props.mode} locate={props.locate} window={props.window} />
    </Guard>
  );
}
