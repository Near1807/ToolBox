# ToolBox — guide pour les sessions Claude Code

> À lire en premier. Court, exact, à jour : si tu changes quelque chose de décrit ici, mets ce fichier à jour dans le même commit.

## Le projet

Application de bureau Windows personnelle de Thomas : un **hub** (page d'accueil + navigation) qui donne accès à des **modules** (outils). V1 : espace « Musique » (bibliothèque de morceaux, générateurs de vidéos YouTube/Instagram, statistiques YouTube). Thomas pilote, Claude code. État d'avancement : `docs/ROADMAP.md`.

**Règle d'or : le socle reste générique, les modules s'adaptent au socle.** Le socle ne connaît aucun module en particulier (ni la musique, ni YouTube). Une ancienne app intégrée plus tard s'adapte au contrat de module ; on ne modifie jamais le socle pour elle.

**Pour ajouter ou modifier un module : lire `docs/MODULES.md` (le contrat) puis `docs/AJOUTER-UN-MODULE.md`.** Point de départ : copier `modules/_template/`.

Modules actuels (section Musique) : `music-library` (bibliothèque, service `musicLibrary`), `video-engine` (moteur FFmpeg partagé, Reels dessinés image par image, service `videoEngine`, sans page), `youtube-video` (générateur 16:9), `instagram-video` (pack Insta : 4 Reels 9:16 au même style sobre, post 4:5, légende, suivi de publication, service `instagramPack`), `release-planner` (planning de sortie : calendrier, upload et programmation YouTube via `ctx.accounts`, rappels Instagram). `youtube-video` fournit le service `youtubeVideo`. Chaque module a son `README.md`.

## Stack

- Electron 44 (coquille) → lance dans son process principal un backend **Fastify** sur `127.0.0.1` (port aléatoire en prod, 47321 en dev).
- Frontend **React 19 + Vite 8 + TypeScript**, routeur `react-router` (HashRouter). Il ne parle au backend **que via l'API REST** (client dans `@hub/sdk/frontend`).
- **SQLite** via `better-sqlite3` (N-API, aucun rebuild pour Electron), base unique `hub.db` dans `app.getPath('userData')`.
- **FFmpeg/FFprobe** embarqués : `ffmpeg-static` + `@derhuerst/ffprobe-static` (même build ; FFmpeg **6.1** sous Windows, 7.0 sous Linux : rester compatible 6.1), dépaquetés de l'asar.
- **Canvas** `@napi-rs/canvas` (Skia, N-API précompilé, dépaqueté de l'asar) : rendu des Reels image par image (ADR 0017).
- Secrets et jetons OAuth chiffrés avec `safeStorage` via l'interface `HostAdapter` (`backend/core/host.ts`). Comptes connectés (`ctx.accounts`, OAuth Google installé : boucle locale + PKCE, ADR 0018) ; notifications Windows et zone de notification (ADR 0019).
- Qualité : ESLint 10 + Prettier, Vitest 5, TypeScript 6 (pas 7 : non supporté par typescript-eslint). zod (manifests), yazl (export .zip).

## Commandes

| Commande                                   | Rôle                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                              | Vite + backend + Electron avec rechargement. UI aussi ouvrable sur http://localhost:5173. **À relancer après l'ajout d'un dossier de module** |
| `TOOLBOX_LOAD_EXAMPLES=1 npm run dev`      | Idem, en chargeant aussi les modules d'exemple (`modules/_*`)                                                                                 |
| `npm run build` / `npm start`              | Build (`build/renderer`, `build/main`) / lance Electron sur le build                                                                          |
| `npm test` / `npm run test:watch`          | Tests Vitest (socle dans `tests/`, modules dans `modules/*/tests/`)                                                                           |
| `npm run lint` / `npm run format`          | ESLint (dont la règle des frontières de modules) + Prettier + aucune couleur en dur dans l'interface (`check:ui-colors`)                      |
| `npm run typecheck`                        | `tsc --noEmit`                                                                                                                                |
| `npm run check:native`                     | Vérifie que better-sqlite3 et @napi-rs/canvas se chargent dans le Node d'Electron                                                             |
| `npm run dist:win`                         | Installateur NSIS + portable dans `dist/` (sous Windows, ou via la CI)                                                                        |
| `node scripts/smoke-test.mjs <exe> [args]` | Auto-test d'un build (API, SQLite, FFmpeg, canvas, module modèle, UI)                                                                         |

Sous Linux en root (conteneur) : ajouter `--no-sandbox` à Electron, et `xvfb-run -a` pour un écran virtuel. Pour voir l’interface : Playwright (`_electron.launch`, s’il est installé dans l’environnement) permet de piloter l’app et de faire des captures.

## Structure

```
electron/        process principal : fenêtre (plein écran, barre sombre), zone de notification et démarrage avec Windows, preload, HostAdapter Electron, smoke test
backend/         server.ts (Fastify) · core/ (hub.ts = chargeur de modules et ctx, migrations, sauvegardes,
                 réglages, tâches, planificateur, événements, services, fichiers générés, comptes, notifications, journaux) · routes/core.ts (/api/core/*)
frontend/src/    shell React : modules/ (découverte, hôte des pages), shell/ (barre latérale à catégories, accueil, fichiers générés, tâches, journaux, réglages), themes/ (un fichier par thème), styles.css
packages/sdk/    @hub/sdk : backend.ts, frontend.tsx, components.tsx (composants partagés), manifest.ts, testing.ts — seul import autorisé aux modules
modules/         un dossier par module ; _template/ = module modèle (exemple, chargé à la demande)
scripts/         dev, build (esbuild + découverte des modules), smoke test, vérification native
tests/           tests Vitest du socle
docs/            ARCHITECTURE, MODULES (contrat), AJOUTER-UN-MODULE, DIRECTION-ARTISTIQUE (visuels générés), THEMES (interface), ROADMAP, WINDOWS, decisions/ (ADR)
site/            site public statique (accueil + confidentialité, exigés par Google OAuth), publié par GitHub Pages depuis hub-v1
```

## Documentation de référence

- `docs/MODULES.md` — **le contrat de module** (la pièce la plus importante).
- `docs/AJOUTER-UN-MODULE.md` — guide pas à pas, dont « Intégrer une app existante ».
- `docs/ARCHITECTURE.md` — vue d'ensemble, démarrage, API du socle, sécurité, données.
- `docs/DIRECTION-ARTISTIQUE.md` — **règles obligatoires pour tout visuel généré** (sobriété, cover toujours entière, vérification sur trois covers).
- `docs/THEMES.md` — thèmes de l'interface : tokens, ajouter un thème (sans rapport avec les visuels générés).
- `docs/ROADMAP.md` — fait / en cours / prévu. `CHANGELOG.md` — versions.
- `docs/decisions/` — ADR : pourquoi chaque choix structurant.

## Conventions

- Code, identifiants et commentaires **en anglais** ; interface et documentation **en français**.
- TypeScript strict partout. Imports sans extension (bundlers). Alias `@hub/sdk/*` → `packages/sdk/*`.
- `dependencies` = uniquement ce que le process principal charge à l'exécution sans le bundler (natif, binaires, Fastify). Tout ce qui est bundlé (React, zod, yazl…) va en `devDependencies`.
- Tout appel API passe par `/api/...` avec l'en-tête `x-toolbox-token`. Les routes SSE (EventSource) utilisent un ticket à usage unique (`POST /api/core/stream-tickets`, puis `?ticket=`) et déclarent `streamTicket: true`.
- Le backend n'importe jamais `electron` : il passe par `HostAdapter`.
- Données utilisateur uniquement sous `userData`, jamais dans le dossier d'installation.
- **Tout fichier généré passe par `ctx.outputs` et est supprimable depuis l'interface** (Corbeille, sélection multiple, « Fichier introuvable »). `docs/MODULES.md` §5.13.
- **Tout est lié à un projet** : `subject` est obligatoire dans `ctx.outputs.register` ; en Musique, c'est le morceau source (`music-library:track:<id>`). La page du morceau est la vue projet (état généré / planifié / programmé / publié, case « Inclure dans la sortie » lue par le Planning). Éléments sans projet : section « Sans projet » de la Bibliothèque (rattacher ou supprimer). ADR 0022.
- **Cohérence de l'interface** : les éléments générés (carte, miniature, case « Publié », boutons Supprimer/Régénérer/Dossier, forme d'onde des extraits, champs de texte) passent par les **composants partagés du SDK** (`packages/sdk/components.tsx`, `docs/MODULES.md` §7.1), jamais par une copie dans un module.
- **Thèmes** : couleurs, arrondis, ombres et polices de l'interface = variables CSS des thèmes (`frontend/src/themes/`, `docs/THEMES.md`). Aucune couleur en dur dans le shell ni dans les modules (`npm run lint` le vérifie). Les thèmes concernent l'interface ; les visuels générés suivent la direction artistique.
- Visuels : respecter `docs/DIRECTION-ARTISTIQUE.md` (sobre ; cover toujours entière, jamais recadrée ni étirée ; seuls mouvements lents de l'image entière ; couleurs de la cover). Pixels carrés (`setsar=1`) en fin de chaîne, son ≤ -1 dBTP. **Tout mouvement est piloté directement par le son, jamais par des événements détectés** (synchro mesurée, ≤ 1 image).
- **Données : une migration publiée ne se modifie jamais ; aucune suppression de données hors migration explicite** (ou demande explicite de l'utilisateur dans l'interface, avec confirmation). Le socle sauvegarde `hub.db` avant chaque migration et restaure en cas d'échec (`docs/MODULES.md` §6).
- Toute modification du contrat de module ou de l'architecture met à jour la doc **dans le même commit**. Nouvelle décision structurante → nouvel ADR.
- Fin de phase : mettre à jour `docs/ROADMAP.md` et `CHANGELOG.md`, versionnage sémantique (`package.json`).

## Git

- Travail sur la branche `hub-v1`. **Jamais** de push, merge ou rebase sur `main` : Thomas décide des fusions.
- Un commit par étape logique, messages clairs. Push à la fin de chaque phase au minimum. La CI construit le `.exe` à chaque push sur `hub-v1`.
- Aucun secret dans le dépôt (`.env` ignoré, `.env.example` documenté). Les identifiants OAuth (ID client, secret) se saisissent dans les réglages de l'app, jamais en dur.
