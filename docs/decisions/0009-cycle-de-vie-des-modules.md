# 0009 — Cycle de vie et frontières des modules

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Le hub doit accueillir pendant des années des modules écrits au fil de sessions différentes, dont d'anciennes applications portées. Il faut un contrat simple, vérifiable automatiquement, et qui protège le hub des erreurs d'un module.

## Décision

- **Ce que voit un module = `@hub/sdk`** (`packages/sdk/`) : types du contrat, `ctx`, helpers. Une règle ESLint maison (`toolbox/module-boundaries`, dans `eslint.config.js`) interdit aux modules d'importer le socle, `electron` ou un autre module, et au socle d'importer un module. Seule exception : `import type` depuis le `contract.ts` d'un autre module (types effacés à la compilation).
- **Déclaratif puis activé** : `register(ctx)` déclare routes, tâches, tâches planifiées, services, écouteurs. Le socle ne les active que si `register()` réussit ; sinon il annule tout. Les routes passent par un collecteur (`ctx.routes`) plutôt que par l'instance Fastify, pour pouvoir envelopper chaque handler (erreurs → JSON, journal) et ne monter que les modules sains.
- **Migrations exportées à côté de `register`** (et non déclarées dedans) : le socle les applique **toutes avant le premier `register()`**, ce qui permet de restaurer la base en cas d'échec sans invalider des modules déjà actifs, et aux modules de préparer leurs requêtes dès `register()`.
- **Dépendances résolues avant le chargement** grâce au manifest (`dependsOn`, `provides`) : ordre topologique, blocage en cascade, cycles refusés. `ctx.services.get()` n'accepte que les services déclarés.
- **Isolation des données par préfixe** : tables `<id>__*` vérifiées à chaque migration ; `ctx.db.prepare()` refuse `CREATE`/`ALTER`/`DROP`.
- **Modules d'exemple** : dossiers `_*`, chargés seulement à la demande (smoke test, `TOOLBOX_LOAD_EXAMPLES=1`). Le module modèle est ainsi compilé, testé et vérifié dans le `.exe` par la CI sans apparaître chez l'utilisateur.

## Conséquences

- Un module mal écrit est contenu : il apparaît « en erreur » avec un message, le reste du hub fonctionne.
- La frontière est vérifiée par `npm run lint` (donc en CI), pas seulement par convention.
- Les handlers de routes reçoivent les objets Fastify : Fastify fait partie du contrat (changer de framework HTTP serait une évolution majeure du contrat).
- Il n'y a pas d'isolation forte (même process, même base) : c'est un choix de simplicité adapté à des modules écrits par nous-mêmes.
