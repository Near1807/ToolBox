# Courses (`courses`)

Catégorie **Vie perso**. La liste de courses se fait en choisissant des **repas**, pas des produits.

**L'outil démarre vide** : aucun ingrédient ni aucune recette livrés (seuls les quatre moments par défaut sont créés). On remplit à la main ou par **import JSON** (format ci-dessous).

## Ce qu'il fait

- **Ingrédients** (onglet « Ingrédients ») : nom, unité par défaut (g, kg, ml, cl, l, pièce, c. à s.…), rayon facultatif. Autocomplétion partout ; un nom déjà pris (accents et majuscules ignorés) est refusé : « riz » et « riz arborio » ne sont deux ingrédients que si tu les crées tous les deux. **Fusionner…** : les lignes de repas de l'un passent à l'autre, le premier est supprimé (logiquement).
  - **Facultatif**, par ingrédient (lien de la colonne « Pièce · nutrition · prix ») : **poids d'une pièce** (g), **valeurs nutritionnelles** pour 100 g ou 100 ml (calories, protéines, glucides, dont sucres, lipides, dont saturés, fibres, sel ; chacune facultative), **prix de référence** au kg, au litre ou à la pièce.
- **Repas** : nom, **image facultative** (glisser-déposer ou « Choisir une image… », remplacer, retirer ; copiée dans l'app, réduite à 1200 px au plus côté le plus long et enregistrée en JPEG ; l'ancienne va à la Corbeille de Windows), nombre de portions de la recette, ingrédients avec quantités et unités, tags (ex. VG, protéiné), note. Un ingrédient tapé qui n'existe pas est marqué « nouvel ingrédient » et créé à l'enregistrement. Bibliothèque en **grille** (avec images) ou en **liste** (choix retenu). Miniature aussi dans le planning ; clic sur le nom d'un repas planifié = aperçu (image, ingrédients, note). Recherche (nom, tags, ingrédients) et filtre par tag. **Par portion** : coût estimé, calories et protéines ; tri « Moins chers d'abord » / « Plus protéinés d'abord », filtre « Max … € / portion ». Suppression confirmée, avec « Annuler ».
- **Planning des repas** (sans images, pour rester compact) : clic sur « + repas » d'un créneau → panneau « Lundi 2 nov. · Midi » avec recherche (focus à l'ouverture), les **mêmes filtres que l'onglet Repas** (composant `MealFilters` et logique `shared/meal-filter.ts` communs), liste qui défile quelle que soit sa longueur, flèches / Entrée / Échap, portions (1 par défaut). Une période (du … au …, semaine par défaut) ; par jour et par moment (Matin, Midi, Collation, Soir — configurables, avec heure et durée par défaut), des repas avec un nombre de portions. Colonne « Jour (estimé) » : calories, protéines et coût du jour ; coût de la période sous le tableau.
- **Liste de courses** générée pour la même période (`shared/quantities.ts`) : quantités de chaque repas ajustées aux portions planifiées (la recette est écrite pour son propre nombre de portions), additionnées par ingrédient avec conversion des unités compatibles (g ↔ kg, ml ↔ cl ↔ l ; et **pièce ↔ poids** quand l'ingrédient a un poids d'une pièce : « 3,5 pièces (≈ 525 g) » ; sans poids, les unités restent à part : « 2 pièces + 10 g »), regroupées par rayon. **Coût estimé** de la liste : sur les quantités utilisées, pas sur les paquets ; repas + **extras qui ont un prix** (le détail repas / extras est affiché, un extra sans prix est nommé et non compté). Plus les **extras** : articles hors repas, à prendre parmi les extras habituels (un clic ; leur prix et leur rayon sont repris) ou tapés à la main, chacun avec un **prix facultatif** modifiable dans la liste. Liste cochable (coche affichée tout de suite, annulée avec un message si l'enregistrement échoue), « Tout décocher », **Copier** (texte) et **Exporter (Markdown)…** (« Enregistrer sous »).
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
      "fridgeDays": 2,
      "freezable": false,
      "freezerDays": null,
      "ingredients": [
        { "name": "Riz arborio", "qty": 320, "unit": "g" },
        { "name": "Oignon", "qty": 1, "unit": "pièce" }
      ],
      "image": "data:image/jpeg;base64,/9j/4AAQ…"
    }
  ]
}
```

- **Ingrédient** : `name` (obligatoire), `unit` (défaut `g`), `aisle`, `pieceWeightG` (g, > 0), `nutritionPer` (`"100g"` ou `"100ml"` ; défaut : `100ml` pour une unité de volume, sinon `100g`), `nutrition` (`kcal`, `protein`, `carbs`, `sugars`, `fat`, `saturated`, `fiber`, `salt`, toutes facultatives, en g sauf `kcal`), `price` (`amount` en €, `per` : `kg`, `l` ou `pièce`) ou `null`.
- **Recette** : `name`, `servings` (entier 1–50, défaut 1), `tags`, `note`, `ingredients` : `{ name, qty, unit }` (par nom, comparé sans accents ni majuscules), `image` facultative : une URL `data:` (JPEG, PNG, WebP ou GIF en base64). L'export complet l'inclut en JPEG ; absente, rien ne change ; illisible, la recette est importée sans image et l'aperçu le signale (avertissement, pas une erreur). Fichier de 200 Mo au plus. **Conservation une fois cuisiné** (batch cooking, v0.26), trois champs facultatifs : `fridgeDays` (jours au frigo, entier ≥ 0, `null` = inconnu), `freezable` (`true` / `false`), `freezerDays` (jours au congélateur, seulement si congelable). **Absents du fichier**, ils ne changent rien : un fichier au format d'avant s'importe exactement comme avant, et même une recette remplacée garde sa conservation. Présents, l'aperçu montre leurs différences (« frigo 3 j → 2 j »), décochées par défaut. L'export les inclut toujours.
- `format` et `version` sont facultatifs à l'import. Un élément en erreur est ignoré, les autres passent. Fichier d'exemple complet : `shared/exchange.ts` (`EXAMPLE`), téléchargeable depuis l'onglet.

## Batch cooking (onglet « Batch »)

Facultatif : sans calcul, rien ne change. L'onglet **propose**, il ne modifie rien (ni le planning, ni les listes de courses, ni les portions). Il travaille sur la période de la liste.

- **Conservation des recettes** (fiche recette, onglet Repas, filtrable) : jours au frigo, congelable, jours au congélateur. Vides par défaut, jamais proposés ni vérifiés par l'app.
- **1. Repas à couvrir** : les repas planifiés de la période, chacun avec sa case. Pré-cochés : ceux dont la recette a le tag « batch » (casse et accents ignorés), qui ne sont pas déjà couverts. Tout repas se coche ou se décoche ; raccourcis tout / rien / tag batch / du jour X au jour Y. Recette sans jours au frigo : signalée, avec « compléter la fiche », et exclue du calcul. Repas déjà couverts par un plan validé : non cochables (annuler d'abord le plan).
- **2. Créneaux de cuisine** : grille jours × moments. Chaque période démarre avec le **modèle habituel** (réglage caché `batchGridModel`, jour de la semaine × identifiant de moment, vide par défaut : « Coche les créneaux où tu peux cuisiner »), projeté sur ses dates. Une modification est enregistrée pour cette période seulement ; le modèle ne change que par « Retenir comme habituels ». Un moment renommé garde ses créneaux, un moment supprimé est ignoré.
- **3. Options** : congélation (non par défaut) ; sessions jusqu'à N jours avant la période (réglage `batchDaysBefore`, 0 par défaut ; ces jours apparaissent dans la grille, marqués « avant la période »).
- **Calculer** (jamais automatique) : `shared/batch.ts`, exact. Une session couvre les repas à son créneau ou après (même moment du même jour compris) dans la durée au frigo ; avec la congélation et une recette congelable, jusqu'à sa durée au congélateur (au-delà du frigo, la portion part au congélateur, jamais mangée le jour de la cuisson). Critères dans l'ordre : le plus de repas couverts, le moins de sessions, le moins de cuissons, le moins de portions congelées, les cuissons les plus proches. Toutes les couvertures minimales sont explorées (recherche exacte, déterministe) ; au-delà d'un budget de recherche (mesuré : 3 semaines avec tous les créneaux cochés), aucun plan plutôt qu'un plan approximatif : « décoche des créneaux ».
- **Résultat** : résumé (« 2 sessions couvrent 9 repas sur 11 ; 2 à cuisiner le jour même »), sessions dans l'ordre (frigo → repas, congélateur → repas « sortir la veille »), quantités à préparer (le calcul de la liste, mis à l'échelle), repas à cuisiner le jour même avec la raison, session avant la période (ingrédients à acheter avant ce jour-là, indication seulement).
- **Valider ce plan** : plusieurs plans par période, jamais sur les mêmes repas. Seulement après validation : rappel « Ce soir, sortir du congélateur » la veille dans le planning (lecture seule), sessions dans le calendrier (heure et durée éditables, vides par défaut). La grille réellement utilisée est enregistrée avec le plan. « Annuler ce plan » (confirmé) libère ses repas. Planning modifié après validation : bandeau « Le planning a changé depuis la validation — recalculer », rien n'est recalculé. Session avant la période sur le créneau d'une session d'un autre plan validé : avertissement, aucune fusion.
- **Limite connue** : une période ne réutilise pas les portions congelées d'une période précédente.

## Calculs

`shared/nutrition.ts` : une ligne de recette se convertit en grammes, millilitres ou pièces quand c'est possible (g ↔ kg, ml ↔ cl ↔ l, pièce ↔ poids avec le poids d'une pièce ; pas de g ↔ ml, pas de cuillères). Nutrition = valeur pour 100 × quantité / 100 ; coût = prix de référence × quantité dans l'unité du prix. Ce qui ne se calcule pas est **signalé « incomplet »** (nom des ingrédients au survol), jamais deviné.

## Assistant (MODULES.md §5.15)

| Action          | Risque | Exemples                                                  |
| --------------- | ------ | --------------------------------------------------------- |
| `what-to-eat`   | read   | « qu'est-ce que je mange ce soir », « … demain midi »     |
| `shopping-list` | read   | « montre ma liste de courses »                            |
| `nutrition`     | read   | « combien de protéines cette semaine », « … aujourd'hui » |
| `cost`          | read   | « combien coûte ma liste », « … mes repas de la semaine » |
| `add-extra`     | change | « ajoute café aux extras »                                |
| `plan-meal`     | change | « mets risotto mardi soir » (prochain mardi, 1 portion)   |

Les modifications sont derrière **« L'assistant peut modifier les repas et la liste de courses »**, désactivé par défaut, et s'annulent. La To-do laisse les phrases « … aux extras / à la liste de courses » aux Courses.

## Données (« Prêt pour la synchro », MODULES.md §6 bis)

Tables `courses__ingredients`, `courses__meals`, `courses__meal_items`, `courses__moments`, `courses__plan`, `courses__extras` (habituels), `courses__lists` (période de la liste ; `closed_at` + `snapshot` JSON pour l'historique), `courses__list_extras`, `courses__list_checks`, `courses__changes` (journal). UUID, `created_at` / `updated_at`, suppression logique partout (`SyncStore`). Migrations 1 et 2 (v0.23 : `piece_g`, `nutrition` JSON, `nutrition_per`, `price`, `price_per` sur les ingrédients ; `closed_at`, `snapshot` sur les listes). **Migration 3 (v0.25)** : une ligne par valeur nutritionnelle (`courses__ingredient_nutrients` : ingrédient, nutriment, valeur) et par prix (`courses__ingredient_prices` : ingrédient, montant, unité), copiées sans perte et journalisées ; colonne `price` sur `courses__extras` et `courses__list_extras` ; `courses__meal_images` (repas, fichier, largeur, hauteur, octets, sha256). Les anciennes colonnes `nutrition`, `price`, `price_per` restent en base mais ne sont plus lues ni écrites (aucune colonne supprimée). L'instantané d'une liste fermée (`snapshot`) reste un bloc JSON : il ne change plus une fois la liste fermée. **Migration 4 (v0.26)** : colonnes ajoutées seulement (`fridge_days`, `freezable` = 0, `freezer_days` sur `courses__meals`, aucune ligne existante modifiée) ; tables du batch cooking `courses__batch_grids` (grille d'une période), `courses__batch_plans` (période, congélation, N, grille utilisée), `courses__batch_sessions` (date, moment, heure et durée facultatives), `courses__batch_portions` (repas planifié couvert, recette, date, moment, portions, congelée) : UUID, dates, suppression logique, journal.

**Images des recettes** : fichiers dans le dossier de données du module (`userData/modules/courses/images/<uuid>.jpg`), pas dans `ctx.outputs` : ce ne sont pas des fichiers générés mais des données de l'utilisateur, rattachées à leur repas (pas de « Sans projet », pas d'`onReattach`). Remplacer ou retirer : ligne supprimée logiquement, fichier envoyé à la Corbeille (`ctx.files.trash`). **Synchro future** : la ligne `courses__meal_images` (avec son `sha256`) se synchronise comme les autres ; le fichier lui-même devra être transféré à part, une seule fois par empreinte. Quatre moments créés au premier lancement. Objectifs : réglages du module (`goalProteinPerDay`, `goalKcalPerDay`, `goalBudgetPerWeek`, 0 = aucun), aussi dans Réglages > Courses.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

Chaque repas planifié = un événement « Soir : Risotto » à l'heure et pour la durée par défaut de son moment, avec ses portions. Chaque session d'un plan de batch cooking **validé** = un événement « Batch cooking : Curry, Dal » (sur la journée tant qu'aucune heure n'est donnée).

## API

| Méthode               | Route                                                                             | Rôle                                                                                           |
| --------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET                   | `/state` · `/home` · `/list/text`                                                 | Tout (ingrédients, repas, moments, planning et liste de la période) · accueil · texte à copier |
| POST · PATCH          | `/ingredients` · `/ingredients/:id` · `/ingredients/merge`                        | Ingrédients, fusion                                                                            |
| POST · PUT · DELETE   | `/meals` · `/meals/:id` (+ `/restore`)                                            | Repas (dont `fridgeDays`, `freezable`, `freezerDays`)                                          |
| GET · PUT · POST      | `/batch?from&to` · `/batch/grid` · `/batch/grid/model`                            | Batch : repas, grille et plans · grille de la période · « Retenir comme habituels »            |
| POST                  | `/batch/compute` · `/batch/plans`                                                 | Proposer (n'écrit rien) · valider un plan                                                      |
| DELETE · PATCH        | `/batch/plans/:id` · `/batch/sessions/:id`                                        | Annuler un plan · heure et durée d'une session                                                 |
| PUT · DELETE          | `/meals/:id/image` `{ path }` ou `{ data }`                                       | Image du repas : ajouter / remplacer, retirer (ancienne à la Corbeille)                        |
| PUT                   | `/moments`                                                                        | Moments (un moment encore planifié ne se retire pas)                                           |
| POST · PATCH · DELETE | `/plan` · `/plan/:id`                                                             | Planning                                                                                       |
| PUT · POST            | `/list` · `/list/check` · `/list/uncheck-all` · `/list/extras` · `/list/export`   | Période, coches, extras, export                                                                |
| POST · PATCH · DELETE | `/extras` · `/extras/:id` · `/list/extras/:id`                                    | Extras habituels (rayon, prix) · quantité et prix d'un extra de la liste                       |
| GET · POST            | `/lists/history` · `/lists/:id/reuse`                                             | Listes précédentes · reprendre comme base                                                      |
| GET · PUT             | `/summary` · `/goals`                                                             | Résumé de la période · objectifs                                                               |
| POST                  | `/import/preview` · `/import/apply` `{ text, overwrite, replaceRecipes, create }` | Aperçu (n'écrit rien) · import confirmé (sauvegarde avant)                                     |
| POST · GET            | `/export-json` · `/example-json`                                                  | Export complet · exemple (« Enregistrer sous » en POST)                                        |

## Tests

`tests/quantities.test.ts` (conversions, unités incompatibles, portions, affichage), `tests/nutrition.test.ts` (conversions, nutrition et coût avec manques, pièces ↔ poids dans la liste), `tests/exchange.test.ts` (lecture, erreurs et leurs lignes, aperçu), `tests/commands.test.ts`, `tests/meal-filter.test.ts` (filtres communs à l'onglet Repas et au sélecteur du planning), `tests/keeping.test.ts` (migration 4 sans changement des données, conservation éditée, ancien JSON sans les champs, différences dans l'aperçu), `tests/batch.test.ts` (optimisation : une session, deux, congélation, non congelable, soir / midi, plusieurs créneaux le même jour, raisons, jamais congelé le jour même, déterminisme, au-delà du budget ; grille : modèle projeté, N jours avant, « Retenir comme habituels »), `tests/batch-form.test.ts` (pré-cochage, cochés à la main, raccourcis, conservation manquante), `tests/batch-plans.test.ts` (grille d'une période et modèle, moment renommé ou supprimé, calcul sans écriture, deux plans, refus d'un chevauchement, annulation, rappels, calendrier, bandeau, N = 0 / 2, avertissement d'une autre période), `tests/images.test.ts` (réduction, JPEG, refus, URL `data:`), `tests/solid.test.ts` (migration 3 sans perte, valeurs écrites une par une, prix des extras dans le coût, lecture de la nutrition et du coût par l'assistant, images : ajout, refus, remplacement vers la Corbeille, retrait, export et import avec une image valide et une invalide), `tests/module.test.ts` (démarrage vide, aperçu sans écriture, import seulement de ce qui est confirmé, sauvegarde, aller-retour export → import → export identique, une liste par période et historique, reprendre comme base, résumé et objectifs, socle réel : doublons refusés, repas, planning sur une période, liste additionnée et convertie, hors période ignoré, fusion, extras, coches, texte, source du calendrier, droit de l'assistant).

## Limites connues

- Batch cooking : les portions congelées d'une période précédente ne sont pas réutilisées ; au-delà d'environ deux semaines avec tous les créneaux cochés, le calcul exact peut refuser (décocher des créneaux).

- Pas d'arrondi « à l'achat » (paquets) ; pas de conversion g ↔ ml (densité) ni pour les cuillères.
