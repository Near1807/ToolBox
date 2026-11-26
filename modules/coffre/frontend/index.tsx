// v0.45.0, v0.50.0 (Expérimental): the Coffre's pages (docs/coffre/CAHIER-DES-CHARGES.md).
// Every page sits in the same frame: drop anywhere, the rangement window, the
// preview, the message with « Annuler ».
import type { ComponentType } from 'react';
import { defineFrontendModule } from '@hub/sdk/frontend';
import { DiskBadge } from './disk/DiskBadge';
import { DiskSettings } from './disk/DiskSettings';
import { LearnedSettings } from './Learned';
import { CoffreFrame } from './frame';
import { HomePage } from './Home';
import { MapPage } from './Atlas';
import { ViewPage } from './SearchResults';
import { ReaderPage } from './ReaderPage';
import { ReceivedPage } from './Received';
import { FolderPage, LabelPage, PendingPage, StatePage, TrashPage } from './Pages';
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
    { path: 'c/:id', component: framed(FolderPage) },
    // v0.50.0: a view by label (« tout ce qui est Python »).
    { path: 'v/:key/:value', component: framed(LabelPage) },
    { path: 'a-ranger', component: framed(PendingPage) },
    { path: 'corbeille', component: framed(TrashPage) },
    // v0.48.0: the map and the tree of the folders, in full.
    { path: 'carte', component: framed(MapPage) },
    { path: 'etat/:state', component: framed(StatePage) },
    // v0.47.0: the hub's search (Ctrl+K): « Tous les résultats », a result at its page.
    { path: 'chercher', component: framed(HomePage) },
    { path: 'voir/:id', component: framed(() => <ViewPage home={HomePage} />) },
    // v0.47.0: files sent by Windows (right click, « Envoyer vers »): the rangement window.
    { path: 'ranger/:batch', component: framed(() => <ReceivedPage home={HomePage} />) },
    // v0.47.0: the reading window (/w/m/coffre/lire/<id>): the reader alone, no frame.
    { path: 'lire/:id', component: ReaderPage },
  ],
  // v0.46.0: the disk at a glance in the sidebar, and its panel in Réglages › Coffre.
  nav: { badge: DiskBadge },
  settingsPanel: {
    label: 'Disque du coffre, ce que le Coffre a appris',
    component: function CoffreSettings() {
      return (
        <>
          <DiskSettings />
          <LearnedSettings />
        </>
      );
    },
  },
});
