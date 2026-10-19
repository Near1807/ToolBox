# ToolBox — guide pour les sessions Claude Code

> À lire en premier. Court, exact, à jour : si tu changes quelque chose de décrit ici, mets ce fichier à jour dans le même commit.

## Le projet

Application de bureau Windows personnelle de Thomas : un **hub** (page d'accueil + navigation) qui donne accès à des **modules** (outils). V1 : espace « Musique » (bibliothèque de morceaux, générateurs de vidéos YouTube/Instagram, statistiques YouTube). Thomas pilote, Claude code.

**Règle d'or : le socle reste générique, les modules s'adaptent au socle.** Le socle ne connaît aucun module en particulier (ni la musique, ni YouTube). Une ancienne app intégrée plus tard s'adapte au contrat de module ; on ne modifie jamais le socle pour elle.

## Stack

- Electron 44 (coquille) → lance dans son process principal un backend **Fastify** sur `127.0.0.1` (port aléatoire en prod, 47321 en dev).
- Frontend **React 19 + Vite 8 + TypeScript**, routeur `react-router` (HashRouter). Il ne parle au backend **que via l'API REST** (`frontend/src/api/client.ts`).
- **SQLite** via `better-sqlite3` (N-API, aucun rebuild pour Electron), base `hub.db` dans `app.getPath('userData')`.
- **FFmpeg/FFprobe** embarqués : `ffmpeg-static` + `@derhuerst/ffprobe-static` (même build), dépaquetés de l'asar.
- Secrets chiffrés avec `safeStorage` via l'interface `HostAdapter` (`backend/core/host.ts`).
- Qualité : ESLint 10 + Prettier, Vitest 5, TypeScript 6 (pas 7 : non supporté par typescript-eslint).

## Commandes

| Commande                                   | Rôle                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `npm run dev`                              | Vite + backend + Electron avec rechargement. UI aussi ouvrable dans un navigateur sur http://localhost:5173 |
| `npm run build`                            | Build UI (`build/renderer`) + main/backend (`build/main`)                                                   |
| `npm start`                                | Lance Electron sur le build                                                                                 |
| `npm test` / `npm run test:watch`          | Tests Vitest                                                                                                |
| `npm run lint` / `npm run format`          | ESLint + Prettier                                                                                           |
| `npm run typecheck`                        | `tsc --noEmit`                                                                                              |
| `npm run check:native`                     | Vérifie que better-sqlite3 se charge dans le Node d'Electron                                                |
| `npm run dist:win`                         | Installateur NSIS + portable dans `dist/` (à lancer sous Windows, ou via la CI)                             |
| `node scripts/smoke-test.mjs <exe> [args]` | Auto-test d'un build (API, SQLite, FFmpeg, UI)                                                              |

Sous Linux en root (conteneur) : ajouter `--no-sandbox` à Electron, et `xvfb-run -a` pour un écran virtuel.

## Structure

```
electron/      process principal : fenêtre, démarrage du backend, preload, HostAdapter Electron, smoke test
backend/       server.ts (Fastify) + core/ (sécurité, base, FFmpeg, host…) — le socle côté serveur
frontend/      shell React : accueil, navigation, réglages, client API, styles (tokens CSS)
modules/       un dossier par module (à partir de la phase 1) — voir docs/MODULES.md
scripts/       dev, build du main (esbuild), smoke test, vérification native
tests/         tests Vitest du socle (les modules ont leurs tests dans leur dossier)
resources/     icône, polices embarquées
docs/          ARCHITECTURE, MODULES (contrat), AJOUTER-UN-MODULE, ROADMAP, WINDOWS, decisions/ (ADR)
```

## Documentation de référence

- `docs/MODULES.md` — **le contrat de module** (la pièce la plus importante).
- `docs/AJOUTER-UN-MODULE.md` — guide pas à pas.
- `docs/ARCHITECTURE.md` — vue d'ensemble, sécurité de l'API, flux dev/prod.
- `docs/ROADMAP.md` — fait / en cours / prévu. `CHANGELOG.md` — versions.
- `docs/decisions/` — ADR : pourquoi chaque choix structurant.

## Conventions

- Code, identifiants et commentaires **en anglais** ; interface et documentation **en français**.
- TypeScript strict partout. Imports sans extension (bundlers).
- `dependencies` = uniquement ce que le process principal charge à l'exécution (externes à esbuild, livrés dans `node_modules`). Tout ce que Vite bundle (React…) va en `devDependencies`.
- Tout appel API passe par `/api/...` avec l'en-tête `x-toolbox-token`. Les routes SSE (EventSource) utilisent un ticket à usage unique (`POST /api/core/stream-tickets`, puis `?ticket=`) et déclarent `config: { streamTicket: true }`.
- Le backend n'importe jamais `electron` : il passe par `HostAdapter`.
- Données utilisateur uniquement sous `userData`, jamais dans le dossier d'installation.
- Toute modification du contrat de module ou de l'architecture met à jour la doc **dans le même commit**. Nouvelle décision structurante → nouvel ADR.
- Fin de phase : mettre à jour `docs/ROADMAP.md` et `CHANGELOG.md`, versionnage sémantique (`package.json`).

## Git

- Travail sur la branche `hub-v1`. **Jamais** de push, merge ou rebase sur `main` : Thomas décide des fusions.
- Un commit par étape logique, messages clairs. Push à la fin de chaque phase au minimum.
- Aucun secret dans le dépôt (`.env` ignoré, `.env.example` documenté).
