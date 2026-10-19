# 0004 — Frontend React + Vite, HashRouter

- Statut : acceptée
- Date : 2026-10-19

## Contexte

L'interface doit être moderne, rapide à développer, utilisable dans un navigateur pendant le développement, et extensible par des modules.

## Décision

- React 19 + Vite 8 + TypeScript. CSS simple avec des variables (tokens) de thème sombre, sans framework CSS, pour limiter les dépendances.
- `react-router` en mode **HashRouter** (`#/settings`) : aucune réécriture d'URL côté serveur nécessaire, fonctionne de la même façon servi par Fastify ou par Vite.
- Tous les appels réseau passent par `frontend/src/api/client.ts`, qui ajoute le jeton de session.

## Conséquences

- Les URL internes contiennent un `#`, sans importance dans une app de bureau.
- Les modules réutiliseront les tokens CSS et les composants partagés (fournis par le SDK en phase 1) pour garder une interface homogène.
