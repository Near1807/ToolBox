# Courses (`courses`) — Expérimental

Catégorie **Vie perso**. La liste de courses se fait en choisissant des **repas**, pas des produits.

**L'outil démarre vide** : aucun ingrédient ni aucune recette livrés (seuls les quatre moments par défaut sont créés). On remplit à la main ou par **import JSON** (format ci-dessous).

## Ce qu'il fait

- **Ingrédients** (onglet « Ingrédients ») : nom, unité par défaut (g, kg, ml, cl, l, pièce, c. à s.…), rayon facultatif. Autocomplétion partout ; un nom déjà pris (accents et majuscules ignorés) est refusé : « riz » et « riz arborio » ne sont deux ingrédients que si tu les crées tous les deux. **Fusionner…** : les lignes de repas de l'un passent à l'autre, le premier est supprimé (logiquement).
  - **Facultatif**, par ingrédient (lien de la colonne « Pièce · nutrition · prix ») : **poids d'une pièce** (g), **valeurs nutritionnelles** pour 100 g ou 100 ml (calories, protéines, glucides, dont sucres, lipides, dont saturés, fibres, sel ; chacune facultative), **prix de référence** au kg, au litre ou à la pièce.
- **Repas** : nom, nombre de portions de la recette, ingrédients avec quantités et unités, tags (ex. VG, protéiné), note. Un ingrédient tapé qui n'existe pas est marqué « nouvel ingrédient » et créé à l'enregistrement. Recherche (nom, tags, ingrédients) et filtre par tag. **Par portion** : coût estimé, calories et protéines ; tri « Moins chers d'abord » / « Plus protéinés d'abord », filtre « Max … € / portion ». Suppression confirmée, avec « Annuler ».
- **Planning des repas** : une période (du … au …, semaine par défaut) ; par jour et par moment (Matin, Midi, Collation, Soir — configurables, avec heure et durée par défaut), des repas avec un nombre de portions. Colonne « Jour (estimé) » : calories, protéines et coût du jour ; coût de la période sous le tableau.
- **Liste de courses** générée pour la même période (`shared/quantities.ts`) : quantités de chaque repas ajustées aux portions planifiées (la recette est écrite pour son propre nombre de portions), additionnées par ingrédient avec conversion des unités compatibles (g ↔ kg, ml ↔ cl ↔ l ; et **pièce ↔ poids** quand l'ingrédient a un poids d'une pièce : « 3,5 pièces (≈ 525 g) » ; sans poids, les unités restent à part : « 2 pièces + 10 g »), regroupées par rayon. **Coût estimé** de la liste : sur les quantités utilisées, pas sur les paquets, extras non comptés (dit dans l'interface). Plus les **extras** : articles hors repas, à prendre parmi les extras habituels (un clic) ou tapés à la main. Liste cochable, « Tout décocher », **Copier** (texte) et **Exporter (Markdown)…** (« Enregistrer sous »).
- **Une liste par période** : les coches appartiennent à la liste, pas à l'ingrédient. Changer de période donne une liste propre ; l'ancienne va dans **« Listes précédentes »** si quelque chose y a été coché ou ajouté (sinon elle n'est pas gardée : les repas restent dans le planning) ; revenir sur une période de l'historique rouvre sa liste telle quelle. Une liste précédente se consulte (telle qu'elle était, avec son coût) et se **reprend comme base** : ses articles absents de la liste en cours y sont ajoutés en extras.
- **Résumé de la semaine** (la période choisie) : moyennes par jour (calories, protéines, coût ; sur les jours qui ont des repas), coût total, graphes protéines et calories par jour, tableau par jour (calories, protéines, glucides, lipides, fibres, coût) avec totaux, repas planifiés les plus et les moins protéinés (par portion). **Objectifs facultatifs** (protéines / jour, calories / jour, budget / semaine, ramené à la durée de la période) : trait sur le graphe, ▲ / ▼ par jour. Valeurs incomplètes signalées (ingrédients sans données, unité qui ne se convertit pas). Que des chiffres, **aucun conseil**.
- **Importer / exporter** (JSON, format ci-dessous) : aperçu **avant** d'écrire (à ajouter, déjà là identiques, à fusionner avec la liste des différences, erreurs avec leur ligne) ; un élément déjà là n'est changé que si on le coche (et une confirmation) ; les ingrédients des recettes absents du catalogue sont proposés à la création (décochés = la recette n'est pas importée) ; **sauvegarde de la base** juste avant l'import (`ctx.db.backup`). Export complet dans le même format (aller-retour sans perte, testé). « Télécharger l'exemple… » et une aide du format dans l'onglet.
- **Carte d'accueil** : repas planifiés aujourd'hui.

## Format JSON (import / export)

```json
{
  "format": "toolbox-courses",
  "version": 1,
  "ingredients": [
    {
      "name": "Oignon",
      "unit": "pièce",
      "aisle": "Fruits et légumes",
      "pieceWeightG": 150,
      "nutritionPer": "100g",
      "nutrition": { "kcal": 40, "protein": 1.1, "carbs": 9.3, "fiber": 1.7 },
      "price": { "amount": 0.3, "per": "pièce" }
    }
  ],
  "recipes": [
    {
      "name": "Risotto",
      "servings": 4,
      "tags": ["végétarien"],
      "note": "Remuer souvent.",
      "ingredients": [
        { "name": "Riz arborio", "qty": 320, "unit": "g" },
        { "name": "Oignon", "qty": 1, "unit": "pièce" }
      ]
    }
  ]
}
```

- **Ingrédient** : `name` (obligatoire), `unit` (défaut `g`), `aisle`, `pieceWeightG` (g, > 0), `nutritionPer` (`"100g"` ou `"100ml"` ; défaut : `100ml` pour une unité de volume, sinon `100g`), `nutrition` (`kcal`, `protein`, `carbs`, `sugars`, `fat`, `saturated`, `fiber`, `salt`, toutes facultatives, en g sauf `kcal`), `price` (`amount` en €, `per` : `kg`, `l` ou `pièce`) ou `null`.
- **Recette** : `name`, `servings` (entier 1–50, défaut 1), `tags`, `note`, `ingredients` : `{ name, qty, unit }` (par nom, comparé sans accents ni majuscules).
- `format` et `version` sont facultatifs à l'import. Un élément en erreur est ignoré, les autres passent. Fichier d'exemple complet : `shared/exchange.ts` (`EXAMPLE`), téléchargeable depuis l'onglet.

## Calculs

`shared/nutrition.ts` : une ligne de recette se convertit en grammes, millilitres ou pièces quand c'est possible (g ↔ kg, ml ↔ cl ↔ l, pièce ↔ poids avec le poids d'une pièce ; pas de g ↔ ml, pas de cuillères). Nutrition = valeur pour 100 × quantité / 100 ; coût = prix de référence × quantité dans l'unité du prix. Ce qui ne se calcule pas est **signalé « incomplet »** (nom des ingrédients au survol), jamais deviné.

## Assistant (MODULES.md §5.15)

| Action          | Risque | Exemples                                                |
| --------------- | ------ | ------------------------------------------------------- |
| `what-to-eat`   | read   | « qu'est-ce que je mange ce soir », « … demain midi »   |
| `shopping-list` | read   | « montre ma liste de courses »                          |
| `add-extra`     | change | « ajoute café aux extras »                              |
| `plan-meal`     | change | « mets risotto mardi soir » (prochain mardi, 1 portion) |

Les modifications sont derrière **« L'assistant peut modifier les repas et la liste de courses »**, désactivé par défaut, et s'annulent. La To-do laisse les phrases « … aux extras / à la liste de courses » aux Courses.

## Données (« Prêt pour la synchro », MODULES.md §6 bis)

Tables `courses__ingredients`, `courses__meals`, `courses__meal_items`, `courses__moments`, `courses__plan`, `courses__extras` (habituels), `courses__lists` (période de la liste ; `closed_at` + `snapshot` JSON pour l'historique), `courses__list_extras`, `courses__list_checks`, `courses__changes` (journal). UUID, `created_at` / `updated_at`, suppression logique partout (`SyncStore`). Migrations 1 et 2 (v0.23 : `piece_g`, `nutrition` JSON, `nutrition_per`, `price`, `price_per` sur les ingrédients ; `closed_at`, `snapshot` sur les listes ; les données existantes restent, sans valeur nutritionnelle ni prix). Quatre moments créés au premier lancement. Objectifs : réglages du module (`goalProteinPerDay`, `goalKcalPerDay`, `goalBudgetPerWeek`, 0 = aucun), aussi dans Réglages > Courses.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

Chaque repas planifié = un événement « Soir : Risotto » à l'heure et pour la durée par défaut de son moment, avec ses portions.

## API

| Méthode               | Route                                                                             | Rôle                                                                                           |
| --------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET                   | `/state` · `/home` · `/list/text`                                                 | Tout (ingrédients, repas, moments, planning et liste de la période) · accueil · texte à copier |
| POST · PATCH          | `/ingredients` · `/ingredients/:id` · `/ingredients/merge`                        | Ingrédients, fusion                                                                            |
| POST · PUT · DELETE   | `/meals` · `/meals/:id` (+ `/restore`)                                            | Repas                                                                                          |
| PUT                   | `/moments`                                                                        | Moments (un moment encore planifié ne se retire pas)                                           |
| POST · PATCH · DELETE | `/plan` · `/plan/:id`                                                             | Planning                                                                                       |
| PUT · POST            | `/list` · `/list/check` · `/list/uncheck-all` · `/list/extras` · `/list/export`   | Période, coches, extras, export                                                                |
| POST · DELETE         | `/extras` · `/extras/:id`                                                         | Extras habituels                                                                               |
| GET · POST            | `/lists/history` · `/lists/:id/reuse`                                             | Listes précédentes · reprendre comme base                                                      |
| GET · PUT             | `/summary` · `/goals`                                                             | Résumé de la période · objectifs                                                               |
| POST                  | `/import/preview` · `/import/apply` `{ text, overwrite, replaceRecipes, create }` | Aperçu (n'écrit rien) · import confirmé (sauvegarde avant)                                     |
| POST · GET            | `/export-json` · `/example-json`                                                  | Export complet · exemple (« Enregistrer sous » en POST)                                        |

## Tests

`tests/quantities.test.ts` (conversions, unités incompatibles, portions, affichage), `tests/nutrition.test.ts` (conversions, nutrition et coût avec manques, pièces ↔ poids dans la liste), `tests/exchange.test.ts` (lecture, erreurs et leurs lignes, aperçu), `tests/commands.test.ts`, `tests/module.test.ts` (démarrage vide, aperçu sans écriture, import seulement de ce qui est confirmé, sauvegarde, aller-retour export → import → export identique, une liste par période et historique, reprendre comme base, résumé et objectifs, socle réel : doublons refusés, repas, planning sur une période, liste additionnée et convertie, hors période ignoré, fusion, extras, coches, texte, source du calendrier, droit de l'assistant).

## À solidifier (prototype)

- Pas d'arrondi « à l'achat » (paquets) ; pas de conversion g ↔ ml (densité) ni pour les cuillères.
- Les extras ne sont pas chiffrés (pas de prix pour un article tapé à la main).
- Valeurs nutritionnelles et listes d'historique en JSON dans la ligne : une modification simultanée sur deux appareils garde la dernière version (synchro future).
- Pas encore d'action de l'assistant sur la nutrition ou le coût.
