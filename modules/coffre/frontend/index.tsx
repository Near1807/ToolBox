// v0.45.0 (Expérimental): the Coffre's pages (docs/coffre/CAHIER-DES-CHARGES.md).
// Every page sits in the same frame: drop anywhere, the rangement window, the
// preview, the message with « Annuler ».
import type { ComponentType } from 'react';
import { defineFrontendModule } from '@hub/sdk/frontend';
import { DiskBadge } from './disk/DiskBadge';
import { DiskSettings } from './disk/DiskSettings';
import { CoffreFrame } from './frame';
import { HomePage } from './Home';
import { ViewPage } from './SearchResults';
import { ArrivalPage, AttributePage, ContextPage, StatePage, TrashPage } from './Pages';
import './coffre.css';

const framed = (Inner: ComponentType) =>
  function Framed() {
    return (
      <CoffreFrame>
        <Inner />
      </CoffreFrame>
    );
  };

export default defineFrontendModule({
  pages: [
    { path: '', component: framed(HomePage) },
    { path: 'c/:id', component: framed(ContextPage) },
    { path: 'v/:key/:value', component: framed(AttributePage) },
    { path: 'arrivee', component: framed(ArrivalPage) },
    { path: 'corbeille', component: framed(TrashPage) },
    { path: 'etat/:state', component: framed(StatePage) },
    // v0.47.0: the hub's search (Ctrl+K): « Tous les résultats », a result at its page.
    { path: 'chercher', component: framed(HomePage) },
    { path: 'voir/:id', component: framed(() => <ViewPage home={HomePage} />) },
  ],
  // v0.46.0: the disk at a glance in the sidebar, and its panel in Réglages › Coffre.
  nav: { badge: DiskBadge },
  settingsPanel: { label: 'Disque du coffre', component: DiskSettings },
});
