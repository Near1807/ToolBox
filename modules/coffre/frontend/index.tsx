// v0.45.0 (Expérimental): the Coffre's pages (docs/coffre/CAHIER-DES-CHARGES.md).
import { defineFrontendModule, EmptyState, Page } from '@hub/sdk/frontend';

function HomePage() {
  return (
    <Page title="Coffre" subtitle="Garder, ranger, retrouver et ouvrir tes fichiers.">
      <EmptyState title="Le Coffre est vide">Glisse un fichier ici pour le ranger.</EmptyState>
    </Page>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: HomePage }],
});
