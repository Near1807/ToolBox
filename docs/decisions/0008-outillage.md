# 0008 — Outillage : TypeScript 6, esbuild, Vitest sous Node

- Statut : acceptée
- Date : 2026-10-19

## Décision

- **TypeScript 6.0** et non 7 : typescript-eslint ne supporte pas encore TypeScript 7 (`<6.1`).
- **Un seul `tsconfig.json`** (strict, `moduleResolution: Bundler`) pour tout le dépôt ; `npm run typecheck` vérifie l'ensemble.
- **esbuild** compile le process principal et le backend en CommonJS (`build/main/*.cjs`). Les `dependencies` restent externes. Plus simple et plus prévisible qu'un outil intégré (electron-vite) dont la configuration aurait dû évoluer avec le système de modules.
- **Vite** pour l'interface (dev avec rechargement à chaud, build de production).
- **Vitest** sous Node (possible grâce à l'ADR 0003).
- **ESLint 10** (configuration « flat ») + **Prettier** ; `npm run lint` vérifie les deux.
- `scripts/dev.mjs` orchestre Vite, esbuild en mode watch et Electron (redémarré à chaque rebuild du main).
