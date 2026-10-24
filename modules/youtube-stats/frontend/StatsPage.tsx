// The module page: four levels of depth (Vue d'ensemble → Morceaux → Vidéos →
// Labo), the Théories, and the « Données » tab (account, sync, CSV, links).
// The tab and the open track / video live in the URL (?tab=…&video=…).
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, Button, EmptyState, Page, useApi, useJobs, useModule } from '@hub/sdk/frontend';
import { DemoBanner, type FilterValues } from './common';
import { Data } from './Data';
import { Lab } from './Lab';
import { Overview } from './Overview';
import { Theories } from './Theories';
import { Tracks } from './Tracks';
import type { StateData } from './types';
import { Videos } from './Videos';

const TABS = [
  ['overview', 'Vue d’ensemble'],
  ['tracks', 'Morceaux'],
  ['videos', 'Vidéos'],
  ['lab', 'Labo'],
  ['theories', 'Théories'],
  ['data', 'Données'],
] as const;
type Tab = (typeof TABS)[number][0];

export function StatsPage() {
  const module = useModule();
  // When a sync ends, the state and every tab are read again (before, the page
  // kept showing the numbers of before the sync until it was reopened); while
  // it runs, the state follows its progress.
  const { jobs } = useJobs(module.id);
  const syncs = jobs.filter((j) => j.type === 'sync');
  const finished = syncs.filter((j) => j.finishedAt !== null).length;
  const active = syncs.find((j) => j.status === 'queued' || j.status === 'running');
  const dataVersion = `${finished}`;
  const state = useApi<StateData>(
    module.url(`/state?v=${dataVersion}-${active ? `${active.id}-${active.progress ?? ''}` : ''}`),
  );
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<FilterValues>({ period: '28', kind: 'all', track: '' });
  const tab = (TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'overview') as Tab;
  const go = (next: Record<string, string>) => setParams(next);
  const openVideo = (id: string | null) =>
    go(id ? { tab: 'videos', video: id } : { tab: 'videos' });
  const openTrack = (id: number | null) =>
    go(id ? { tab: 'tracks', track: String(id) } : { tab: 'tracks' });
  const s = state.data;
  const demo = s?.mode === 'demo';
  const empty = s && !demo && !s.hasData;

  return (
    <Page
      title="Stats YouTube"
      subtitle={
        demo
          ? 'Chaîne de démonstration'
          : s?.channel
            ? `${s.channel.title} — toutes tes statistiques, croisées avec tes morceaux`
            : 'Toutes tes statistiques YouTube, croisées avec tes morceaux'
      }
      actions={
        s && !demo && s.account.connected && s.account.scopesOk ? (
          <Button
            variant="secondary"
            disabled={Boolean(s.syncing)}
            onClick={() => void module.api.post('/sync').then(state.reload, state.reload)}
          >
            {s.syncing
              ? `Synchronisation… ${s.syncing.progress !== null ? `${Math.round(s.syncing.progress * 100)} %` : ''}`
              : 'Synchroniser maintenant'}
          </Button>
        ) : null
      }
    >
      {demo && <DemoBanner />}
      <nav className="ys-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => go({ tab: id })}
          >
            {label}
          </button>
        ))}
      </nav>
      {empty && tab !== 'data' ? (
        <EmptyState title="Pas encore de statistiques.">
          {s.account.connected && s.account.scopesOk
            ? 'La première synchronisation est en cours ou n’a rien trouvé : regarde l’onglet « Données ».'
            : 'Connecte ton compte Google et autorise l’accès aux statistiques (onglet « Données »), ou active le mode démo dans les réglages du module pour voir l’outil rempli.'}
          <div className="toolbar">
            <Button onClick={() => go({ tab: 'data' })}>Ouvrir « Données »</Button>
            <Button
              variant="secondary"
              onClick={() =>
                void api
                  .put(`/api/core/settings/${module.id}`, { demoMode: true })
                  .then(() => window.location.reload())
              }
            >
              Voir la démo
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div key={dataVersion} className="ys-tab">
          {tab === 'overview' && (
            <Overview
              filters={filters}
              onFilters={setFilters}
              openVideo={openVideo}
              openTrack={openTrack}
            />
          )}
          {tab === 'tracks' && (
            <Tracks
              trackId={params.get('track') ? Number(params.get('track')) : null}
              openTrack={openTrack}
              openVideo={openVideo}
            />
          )}
          {tab === 'videos' && (
            <Videos
              filters={filters}
              onFilters={setFilters}
              videoId={params.get('video')}
              openVideo={openVideo}
            />
          )}
          {tab === 'lab' && <Lab openVideo={openVideo} openTrack={openTrack} />}
          {tab === 'theories' && <Theories />}
          {tab === 'data' && <Data state={s ?? null} reload={state.reload} />}
        </div>
      )}
    </Page>
  );
}
