# @hub/sdk

Seul code du socle qu'un module a le droit d'importer (règle vérifiée par ESLint).

| Import              | Contenu                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `@hub/sdk/backend`  | Contrat backend : `defineBackendModule`, types de `ctx`, `HttpError`, `openEventStream`           |
| `@hub/sdk/frontend` | Contrat frontend : `defineFrontendModule`, `useModule`, `useApi`, `useJobs`, `api`, composants UI |
| `@hub/sdk/manifest` | Types du manifest `module.json` et des réglages                                                   |
| `@hub/sdk/testing`  | `createTestHub()` pour tester un module avec un vrai socle (tests uniquement)                     |

Le contrat complet est décrit dans [`docs/MODULES.md`](../../docs/MODULES.md).
