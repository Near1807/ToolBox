# 0003 — SQLite avec better-sqlite3 (N-API, sans rebuild)

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Il faut une base locale, sans serveur, robuste et simple à sauvegarder. Le piège classique de `better-sqlite3` avec Electron : un module natif compilé pour Node ne se charge pas dans Electron (ABI différente), ce qui oblige à recompiler pour Electron et casse alors les tests lancés sous Node.

## Décision

- SQLite via `better-sqlite3` (synchrone, rapide, transactions simples). Un seul fichier `hub.db` dans `app.getPath('userData')`, en mode WAL, clés étrangères activées.
- `better-sqlite3` ≥ 13 est distribué avec des binaires **N-API** précompilés (`prebuilds/<plateforme>-<arch>.node`) : **le même binaire fonctionne sous Node et sous Electron**, sans aucune recompilation. Vérifié : Node 22 et Electron 44 (Node 24) chargent le même fichier.
- Donc : `npmRebuild: false` dans electron-builder, pas de `postinstall` de rebuild, tests Vitest sous Node.
- Garde-fou : `npm run check:native` charge le module dans le Node d'Electron (`ELECTRON_RUN_AS_NODE`) ; la CI le lance, et le smoke test du `.exe` vérifie SQLite dans l'app empaquetée.

## Conséquences

- Installation plus simple et plus rapide (pas de compilateur C++ requis).
- Si une future version abandonnait N-API, `check:native` échouerait : il faudrait alors réactiver `electron-builder install-app-deps` et lancer les tests sous Electron (`ELECTRON_RUN_AS_NODE=1 electron vitest`).
- Alternative envisagée : `node:sqlite` (intégré à Node). Pas encore stable et pas imposé par le cahier des charges.
