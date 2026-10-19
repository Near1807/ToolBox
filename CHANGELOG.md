# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [sémantique](https://semver.org/lang/fr/).

## [Non publié]

## [0.1.0] — 2026-10-19

Phase 0 : squelette de l'application.

### Ajouté

- Coquille Electron (fenêtre unique, instance unique, liens externes ouverts dans le navigateur).
- Backend Fastify local lancé par le process principal, sécurisé : vérification `Host`/`Origin`, jeton de session, tickets à usage unique pour les flux SSE.
- Base SQLite (`hub.db` dans le dossier de données utilisateur) et FFmpeg/FFprobe embarqués (6.1 sous Windows).
- Interface React en mode sombre : accueil, navigation latérale, page Réglages (version, dossier de données, versions de SQLite/FFmpeg).
- Scripts `dev` (UI aussi utilisable dans un navigateur), `build`, `test`, `lint`, `typecheck`, `check:native`, `dist:win`.
- Packaging Windows : installateur NSIS et version portable (x64), non signés.
- Workflow GitHub Actions `build-windows.yml` : tests, build, smoke test du `.exe` empaqueté, artefacts, GitHub Release sur les tags `v*`.
- Documentation : `CLAUDE.md`, architecture, brouillon du contrat de module, feuille de route, guide Windows, ADR 0001 à 0008.
