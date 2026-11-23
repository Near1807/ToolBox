// v0.47.0 (Expérimental): « Lire en plein écran » — an element in a reading
// window of its own (route /w/m/coffre/lire/<id>, ADR 0058): no ToolBox
// interface, the SAME readers as the preview (`ReaderView`, `window` mode:
// a PDF's tools, a Markdown's table of contents, line numbers, a zoom).
// F11: full screen; the window's own button closes it (Échap closes nothing).
// An archived element is read from the disk (plugged in).
import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { isRunnable } from '@hub/sdk/core';
import { Button, ErrorMessage, formatBytes, useApi, useModule } from '@hub/sdk/frontend';
import type { ItemDto } from '../shared/types';
import { extOfItem } from './logic';
import { iconOf, ReaderView } from './ReaderView';

interface Tools {
  vscode: boolean;
}

export function ReaderPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const module = useModule();
  const item = useApi<ItemDto>(id ? module.url(`/items/${id}`) : null);
  const tools = useApi<Tools>(module.url('/tools'));
  const it = item.data;
  useEffect(() => {
    if (it) document.title = `${it.name} — ToolBox`;
  }, [it]);
  const source = useMemo(
    () => (it ? { name: it.name, ext: extOfItem(it), size: it.size, url: it.url } : null),
    // The same file: the same source (the reader does not read it again).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [it?.id, it?.url, it?.size],
  );
  const locate = useMemo(
    () => ({
      page: Number(params.get('page')) || undefined,
      query: params.get('q') ?? undefined,
    }),
    [params],
  );
  if (item.error) return <ErrorMessage>{item.error}</ErrorMessage>;
  if (!it || !source) return null;

  const code = it.attributes.some((a) => a.key === 'nature' && a.value === 'code');
  const openIn = (how: 'app' | 'vscode' | 'folder') => {
    const runnable =
      how === 'app' && isRunnable(it.name)
        ? window.confirm(
            `« ${it.name} » est un programme ou un script : l’ouvrir le LANCE sur ce PC.\n\nLe lancer quand même ?`,
          )
        : false;
    if (how === 'app' && isRunnable(it.name) && !runnable) return;
    void module.api
      .post(`/items/${it.id}/open`, {
        how: it.diskState === 'archived' && how === 'app' ? 'readcopy' : how,
        runnable,
      })
      .catch((e: unknown) => window.alert(String(e instanceof Error ? e.message : e)));
  };

  return (
    <div className="coffre-readwin" data-coffre-readwin>
      <header className="coffre-readwin__head">
        <div className="coffre-readwin__title">
          <strong>{it.name}</strong>
          <span className="muted small">
            {[
              it.contextPath?.join(' › ') ?? 'Arrivée',
              formatBytes(it.size),
              it.diskState === 'archived' ? 'archivé, lu depuis le disque' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <span className="badge badge--warning">Expérimental</span>
        <span className="muted small coffre-readwin__keys">F11 : plein écran</span>
        {code && tools.data?.vscode && (
          <Button variant="secondary" onClick={() => openIn('vscode')}>
            Ouvrir dans VS Code
          </Button>
        )}
        <Button variant="secondary" onClick={() => openIn('app')}>
          Ouvrir dans son application
        </Button>
        <Button variant="secondary" onClick={() => openIn('folder')}>
          Afficher dans l’explorateur
        </Button>
      </header>
      <div className="coffre-readwin__body">
        <ReaderView
          source={source}
          mode="full"
          window
          locate={locate}
          icon={iconOf(it)}
          fallback={
            <p className="muted">
              {it.unavailable
                ? 'Archivé : sur le disque du coffre. Branche-le pour le lire.'
                : 'Pas d’aperçu pour ce type de fichier.'}
            </p>
          }
        />
      </div>
    </div>
  );
}
