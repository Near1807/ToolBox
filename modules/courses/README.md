# Courses (`courses`) — Expérimental

Catégorie **Vie perso**. La liste de courses se fait en choisissant des **repas**, pas des produits.

## Ce qu'il fait

- **Ingrédients** (onglet « Ingrédients ») : nom, unité par défaut (g, kg, ml, cl, l, pièce, c. à s.…), rayon facultatif. Autocomplétion partout ; un nom déjà pris (accents et majuscules ignorés) est refusé : « riz » et « riz arborio » ne sont deux ingrédients que si tu les crées tous les deux. **Fusionner…** : les lignes de repas de l'un passent à l'autre, le premier est supprimé (logiquement).
- **Repas** : nom, nombre de portions de la recette, ingrédients avec quantités et unités, tags (ex. VG, protéiné), note. Un ingrédient tapé qui n'existe pas est marqué « nouvel ingrédient » et créé à l'enregistrement. Recherche (nom, tags, ingrédients) et filtre par tag. Suppression confirmée, avec « Annuler ».
- **Planning des repas** : une période (du … au …, semaine par défaut) ; par jour et par moment (Matin, Midi, Collation, Soir — configurables, avec heure et durée par défaut), des repas avec un nombre de portions.
- **Liste de courses** générée pour la même période (`shared/quantities.ts`) : quantités de chaque repas ajustées aux portions planifiées (la recette est écrite pour son propre nombre de portions), additionnées par ingrédient avec conversion des unités compatibles (g ↔ kg, ml ↔ cl ↔ l ; les autres restent à part : « 2 pièces + 10 g »), regroupées par rayon. Plus les **extras** : articles hors repas, à prendre parmi les extras habituels (un clic) ou tapés à la main. Liste cochable, « Tout décocher », **Copier** (texte) et **Exporter (Markdown)…** (« Enregistrer sous »).
- **Carte d'accueil** : repas planifiés aujourd'hui.

## Assistant (MODULES.md §5.15)

| Action          | Risque | Exemples                                                |
| --------------- | ------ | ------------------------------------------------------- |
| `what-to-eat`   | read   | « qu'est-ce que je mange ce soir », « … demain midi »   |
| `shopping-list` | read   | « montre ma liste de courses »                          |
| `add-extra`     | change | « ajoute café aux extras »                              |
| `plan-meal`     | change | « mets risotto mardi soir » (prochain mardi, 1 portion) |

Les modifications sont derrière **« L'assistant peut modifier les repas et la liste de courses »**, désactivé par défaut, et s'annulent. La To-do laisse les phrases « … aux extras / à la liste de courses » aux Courses.

## Données (« Prêt pour la synchro », MODULES.md §6 bis)

Tables `courses__ingredients`, `courses__meals`, `courses__meal_items`, `courses__moments`, `courses__plan`, `courses__extras` (habituels), `courses__lists` (période de la liste), `courses__list_extras`, `courses__list_checks`, `courses__changes` (journal). UUID, `created_at` / `updated_at`, suppression logique partout (`SyncStore`). Migration 1 ; quatre moments créés au premier lancement.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

Chaque repas planifié = un événement « Soir : Risotto » à l'heure et pour la durée par défaut de son moment, avec ses portions.

## API

| Méthode               | Route                                                                           | Rôle                                                                                           |
| --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET                   | `/state` · `/home` · `/list/text`                                               | Tout (ingrédients, repas, moments, planning et liste de la période) · accueil · texte à copier |
| POST · PATCH          | `/ingredients` · `/ingredients/:id` · `/ingredients/merge`                      | Ingrédients, fusion                                                                            |
| POST · PUT · DELETE   | `/meals` · `/meals/:id` (+ `/restore`)                                          | Repas                                                                                          |
| PUT                   | `/moments`                                                                      | Moments (un moment encore planifié ne se retire pas)                                           |
| POST · PATCH · DELETE | `/plan` · `/plan/:id`                                                           | Planning                                                                                       |
| PUT · POST            | `/list` · `/list/check` · `/list/uncheck-all` · `/list/extras` · `/list/export` | Période, coches, extras, export                                                                |
| POST · DELETE         | `/extras` · `/extras/:id`                                                       | Extras habituels                                                                               |

## Tests

`tests/quantities.test.ts` (conversions, unités incompatibles, portions, affichage), `tests/commands.test.ts`, `tests/module.test.ts` (socle réel : doublons refusés, repas, planning sur une période, liste additionnée et convertie, hors période ignoré, fusion, extras, coches, texte, source du calendrier, droit de l'assistant).

## À solidifier (prototype)

- Pas de conversion entre unités de nature différente (pièce ↔ g) ni d'arrondi « à l'achat » (paquets).
- Une seule liste en cours (la période choisie) ; pas d'historique des listes.
- Les coches restent attachées à l'ingrédient pour la période (changer la période garde les coches).
