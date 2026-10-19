# 0007 — Distribution Windows non signée, CI GitHub Actions

- Statut : acceptée
- Date : 2026-10-19

## Contexte

L'app est destinée au PC Windows de Thomas. Il faut un `.exe` reproductible, sans dépendre d'une machine de build locale.

## Décision

- electron-builder : installateur **NSIS** (choix du dossier, raccourcis, données conservées à la désinstallation) et version **portable**, x64.
- **Non signé** : l'avertissement SmartScreen est documenté dans `docs/WINDOWS.md`.
- Workflow `.github/workflows/build-windows.yml` sur `windows-latest`, déclenché par les tags `v*`, manuellement (`workflow_dispatch`, disponible une fois le fichier sur `main`), et par les pushes sur la branche de développement `hub-v1`. Étapes : lint, typecheck, tests, `check:native`, `dist:win`, **smoke test du `.exe` empaqueté**, publication des artefacts, GitHub Release pour les tags.
- Les fichiers sont forcés en fins de ligne LF (`.gitattributes`) pour que Prettier passe sous Windows.

## Conséquences

- Chaque version publiée est testée en conditions réelles (hors mode dev) avant publication.
- Pas de mise à jour automatique pour l'instant (feuille de route).
