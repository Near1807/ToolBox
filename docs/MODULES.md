# Contrat de module

> **Statut : brouillon (phase 0).** Le contrat sera implémenté et décrit en détail en phase 1. Ce document fixe dès maintenant les principes, qui ne changeront pas.

## Principes

1. **Le socle est générique** : il ne connaît aucun module en particulier. Les modules s'adaptent au socle, jamais l'inverse.
2. **Un module = un dossier** `modules/<id>/`. **Ajouter un module = ajouter un dossier, puis rebuild** (`npm run build` / `npm run dist:win`). Les modules sont découverts automatiquement **au build** et compilés dans l'application : on n'installe pas un module dans une app déjà installée (voir `docs/decisions/0005-modules-compiles-dans-l-app.md`).
3. **Isolation** : un module n'importe jamais le code d'un autre module, ni celui du socle. Il ne dépend que du SDK (`@hub/sdk`) et communique avec les autres modules par `ctx.services` et `ctx.events`. Une règle ESLint le vérifie.
4. **Propriété des données** : un module ne touche qu'à ses propres tables (préfixées par son id) et à ses propres dossiers.
5. **Dépendances déclarées** dans le manifest ; le socle refuse de charger un module dont une dépendance manque, avec un message clair.
6. **Retrait sans casse** : supprimer le dossier d'un module (puis rebuild) ne casse ni le socle ni les autres modules.

## Structure prévue

```
modules/<id>/
├─ module.json          manifest : id, name, description, version, section, icon, dependsOn, permissions
├─ backend/index.ts     export register(ctx) : routes (/api/modules/<id>/…), migrations, jobs, services
├─ frontend/index.tsx   pages, entrée de navigation, widget d'accueil éventuel
├─ README.md            ce que fait le module, ses données, ses dépendances
└─ tests/               tests Vitest du module
```

Le contexte `ctx` fournira : `db`, `files`, `settings`, `accounts`, `jobs`, `scheduler`, `events`, `services`, `logger`. Leur API exacte sera documentée ici en phase 1.
