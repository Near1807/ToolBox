# ToolBox — guide pour les sessions Claude Code

> À lire en premier. Court, exact, à jour : si tu changes quelque chose de décrit ici, mets ce fichier à jour dans le même commit.

## Le projet

Application de bureau Windows personnelle de Thomas : un **hub** (page d'accueil + navigation) qui donne accès à des **modules** (outils). V1 : espace « Musique » (bibliothèque de morceaux, générateurs de vidéos YouTube/Instagram, statistiques YouTube). Thomas pilote, Claude code. État d'avancement : `docs/ROADMAP.md`.

**Règle d'or : le socle reste générique, les modules s'adaptent au socle.** Le socle ne connaît aucun module en particulier (ni la musique, ni YouTube). Une ancienne app intégrée plus tard s'adapte au contrat de module ; on ne modifie jamais le socle pour elle.

**Pour ajouter ou modifier un module : lire `docs/MODULES.md` (le contrat) puis `docs/AJOUTER-UN-MODULE.md`.** Point de départ : copier `modules/_template/`.

Modules actuels (section Musique) : `music-library` (bibliothèque, service `musicLibrary`), `video-engine` (moteur FFmpeg partagé, service `videoEngine`, sans page), `youtube-video` (générateur 16:9), `instagram-video` (pack Insta : 4 Reels 9:16 de styles différents, post 4:5, légende, suivi de publication). Chaque module a son `README.md`.

## Stack

- Electron 44 (coquille) → lance dans son process principal un backend **Fastify** sur `127.0.0.1` (port aléatoire en prod, 47321 en dev).
- Frontend **React 19 + Vite 8 + TypeScript**, routeur `react-router` (HashRouter). Il ne parle au backend **que via l'API REST** (client dans `@hub/sdk/frontend`).
- **SQLite** via `better-sqlite3` (N-API, aucun rebuild pour Electron), base unique `hub.db` dans `app.getPath('userData')`.
- **FFmpeg/FFprobe** embarqués : `ffmpeg-static` + `@derhuerst/ffprobe-static` (même build ; FFmpeg **6.1** sous Windows, 7.0 sous Linux : rester compatible 6.1), dépaquetés de l'asar.
- Secrets chiffrés avec `safeStorage` via l'interface `HostAdapter` (`backend/core/host.ts`).
- Qualité : ESLint 10 + Prettier, Vitest 5, TypeScript 6 (pas 7 : non supporté par typescript-eslint). zod (manifests), yazl (export .zip).

## Commandes

| Commande                                   | Rôle                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                              | Vite + backend + Electron avec rechargement. UI aussi ouvrable sur http://localhost:5173. **À relancer après l'ajout d'un dossier de module** |
| `TOOLBOX_LOAD_EXAMPLES=1 npm run dev`      | Idem, en chargeant aussi les modules d'exemple (`modules/_*`)                                                                                 |
| `npm run build` / `npm start`              | Build (`build/renderer`, `build/main`) / lance Electron sur le build                                                                          |
| `npm test` / `npm run test:watch`          | Tests Vitest (socle dans `tests/`, modules dans `modules/*/tests/`)                                                                           |
| `npm run lint` / `npm run format`          | ESLint (dont la règle des frontières de modules) + Prettier                                                                                   |
| `npm run typecheck`                        | `tsc --noEmit`                                                                                                                                |
| `npm run check:native`                     | Vérifie que better-sqlite3 se charge dans le Node d'Electron                                                                                  |
| `npm run dist:win`                         | Installateur NSIS + portable dans `dist/` (sous Windows, ou via la CI)                                                                        |
| `node scripts/smoke-test.mjs <exe> [args]` | Auto-test d'un build (API, SQLite, FFmpeg, module modèle, UI)                                                                                 |

Sous Linux en root (conteneur) : ajouter `--no-sandbox` à Electron, et `xvfb-run -a` pour un écran virtuel. Pour voir l’interface : Playwright (`_electron.launch`, s’il est installé dans l’environnement) permet de piloter l’app et de faire des captures.

## Structure

```
electron/        process principal : fenêtre, démarrage, preload, HostAdapter Electron, smoke test
backend/         server.ts (Fastify) · core/ (hub.ts = chargeur de modules et ctx, migrations, sauvegardes,
                 réglages, tâches, planificateur, événements, services, fichiers générés, journaux) · routes/core.ts (/api/core/*)
frontend/src/    shell React : modules/ (découverte, hôte des pages), shell/ (accueil, fichiers générés, tâches, journaux, réglages), styles.css
packages/sdk/    @hub/sdk : backend.ts, frontend.tsx, manifest.ts, testing.ts — seul import autorisé aux modules
modules/         un dossier par module ; _template/ = module modèle (exemple, chargé à la demande)
scripts/         dev, build (esbuild + découverte des modules), smoke test, vérification native
tests/           tests Vitest du socle
docs/            ARCHITECTURE, MODULES (contrat), AJOUTER-UN-MODULE, ROADMAP, WINDOWS, decisions/ (ADR)
```

## Documentation de référence

- `docs/MODULES.md` — **le contrat de module** (la pièce la plus importante).
- `docs/AJOUTER-UN-MODULE.md` — guide pas à pas, dont « Intégrer une app existante ».
- `docs/ARCHITECTURE.md` — vue d'ensemble, démarrage, API du socle, sécurité, données.
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
- Vidéos : pixels carrés (`setsar=1`) en fin de chaîne, la cover n'est jamais étirée. Les Reels n'ont pas de spectre (signature des vidéos YouTube).
- **Données : une migration publiée ne se modifie jamais ; aucune suppression de données hors migration explicite** (ou demande explicite de l'utilisateur dans l'interface, avec confirmation). Le socle sauvegarde `hub.db` avant chaque migration et restaure en cas d'échec (`docs/MODULES.md` §6).
- Toute modification du contrat de module ou de l'architecture met à jour la doc **dans le même commit**. Nouvelle décision structurante → nouvel ADR.
- Fin de phase : mettre à jour `docs/ROADMAP.md` et `CHANGELOG.md`, versionnage sémantique (`package.json`).

## Git

- Travail sur la branche `hub-v1`. **Jamais** de push, merge ou rebase sur `main` : Thomas décide des fusions.
- Un commit par étape logique, messages clairs. Push à la fin de chaque phase au minimum. La CI construit le `.exe` à chaque push sur `hub-v1`.
- Aucun secret dans le dépôt (`.env` ignoré, `.env.example` documenté).
