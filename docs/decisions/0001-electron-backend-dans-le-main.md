# 0001 — Electron, backend dans le process principal

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Application de bureau Windows personnelle, en JavaScript/TypeScript, avec un frontend et un backend séparés qui communiquent par une API REST locale. Les tokens OAuth doivent être chiffrés avec `safeStorage`, qui n'existe que dans le process principal d'Electron.

## Décision

- Electron comme coquille. Le backend Fastify démarre **dans le process principal** (`electron/main.ts` → `startServer()`), sur `127.0.0.1`.
- Le backend n'importe jamais `electron` : les besoins système (chiffrement, ouverture de dossiers) passent par l'interface `HostAdapter` (`backend/core/host.ts`), implémentée par `electron/host.ts` et simulée dans les tests.
- Les traitements lourds (FFmpeg) tournent dans des process enfants, jamais dans la boucle d'événements du backend.

## Conséquences

- Un seul process, un seul runtime Node, `safeStorage` directement disponible.
- Le backend reste testable en Node pur (Vitest) grâce à `HostAdapter`.
- Un calcul synchrone lourd dans le backend gèlerait aussi la gestion des fenêtres : à éviter (passer par un process enfant ou un worker).
- Alternative écartée : backend dans un `utilityProcess` séparé. Plus isolé, mais imposait un pont IPC pour `safeStorage` sans bénéfice concret à ce stade.
