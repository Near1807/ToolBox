# Courses (`courses`)

Catégorie **Vie perso**. La liste de courses se fait en choisissant des **repas**, pas des produits.

**L'outil démarre vide** : aucun ingrédient ni aucune recette livrés (seuls les quatre moments par défaut sont créés). On remplit à la main ou par **import JSON** (format ci-dessous).

## Ce qu'il fait

- **Ingrédients** (onglet « Ingrédients ») : nom, unité par défaut (g, kg, ml, cl, l, pièce, c. à s.…), rayon facultatif. Autocomplétion partout ; un nom déjà pris (accents et majuscules ignorés) est refusé : « riz » et « riz arborio » ne sont deux ingrédients que si tu les crées tous les deux. **Fusionner…** : les lignes de repas de l'un passent à l'autre, le premier est supprimé (logiquement).
  - **Facultatif**, par ingrédient (lien de la colonne « Pièce · nutrition · prix ») : **poids d'une pièce** (g), **valeurs nutritionnelles** pour 100 g ou 100 ml (calories, protéines, glucides, dont sucres, lipides, dont saturés, fibres, sel ; chacune facultative), **prix de référence** au kg, au litre ou à la pièce.
- **Repas** : nom, **image facultative** (glisser-déposer ou « Choisir une image… », remplacer, retirer ; copiée dans l'app, réduite à 1200 px au plus côté le plus long et enregistrée en JPEG ; l'ancienne va à la Corbeille de Windows), nombre de portions de la recette, ingrédients avec quantités et unités, tags (ex. VG, protéiné), note. Un ingrédient tapé qui n'existe pas est marqué « nouvel ingrédient » et créé à l'enregistrement. Bibliothèque en **grille** (avec images) ou en **liste** (choix retenu). Clic sur le nom d'un repas planifié = aperçu (image, ingrédients, note). Recherche (nom, tags, ingrédients, y compris ceux des préparations ; accents, majuscules et ligatures ignorés : « oeuf » trouve « Œuf ») et filtre par tag. **Par portion** : coût estimé, calories et protéines ; tri « Moins chers d'abord » / « Plus protéinés d'abord », filtre « Max … € / portion ». Suppression confirmée, avec « Annuler ».
- **Préparations** (Repas › Préparations, v0.27) : des **fiches techniques** définies une fois et utilisées par plusieurs recettes (le riz cuit d'une session dans le chili et dans les boîtes). Une préparation : nom (unique, sans casse, accents ni ligatures), composition **pour une portion** (ingrédients seulement, mêmes unités que les recettes, pas de conversion g ↔ ml), conservation (vide par défaut), note. Liste : nom, conservation, recettes qui l'utilisent. Changer la composition d'une préparation utilisée : avertissement « Utilisée par N recettes : leurs apports et listes de courses vont changer » (avec la liste), confirmé. Supprimer une préparation utilisée : refusé, avec les recettes et « Remplacer par ses ingrédients dans ces recettes » (confirmé). Suppression annulable.
- **Lignes préparation** dans une recette : « Sauce bolognaise × 4 portions » (décimales permises), avec à côté ce qu'elle représente en aliments. La quantité décrit ce qu'il faut pour **toute la recette** (ses portions), exactement comme une ligne d'ingrédient : la mise à l'échelle avec les portions planifiées est la même. **Extraire en préparation** (fiche d'une recette enregistrée) : cocher des lignes, nommer la préparation (nouvelle, ramenée à une portion ; ou une existante aux mêmes proportions), aperçu, confirmation ; les lignes deviennent une ligne préparation. **Remplacer par ses ingrédients** : l'inverse, confirmé. Dans les deux cas le dépliage reste strictement le même (vérifié par le serveur, sinon rien n'est fait). Recette **découpée** (au moins une préparation) : ses lignes directes sont « au moment du repas », sa conservation propre reste en base mais n'a plus d'effet (dit dans l'éditeur) ; l'onglet Repas affiche « préparations : X sur Y renseignées » et le filtre de conservation s'appuie sur ses préparations.
- **Une seule fonction de dépliage** (`shared/recipe.ts`, `expandRecipe`) : lignes directes + ingrédients de chaque préparation × ses portions. Tous les calculs (nutrition, coût, liste, résumé, objectifs, historique, filtres, assistant, quantités du batch) la lisent, via `MealDto.items` ; seuls l'éditeur de recette et l'import / export lisent la structure (`MealDto.lines`). Quantités issues d'une préparation : produit arrondi à 9 décimales dans le calcul (jamais en base), l'écran arrondit à 3.
- **Planning des repas** (sans images, pour rester compact) : clic sur « + repas » d'un créneau → panneau « Lundi 2 nov. · Midi » avec recherche (focus à l'ouverture), les **mêmes filtres que l'onglet Repas** (composant `MealFilters` et logique `shared/meal-filter.ts` communs), liste qui défile quelle que soit sa longueur, flèches / Entrée / Échap, portions (1 par défaut). Une période (du … au …, semaine par défaut) ; par jour et par moment (Matin, Midi, Collation, Soir — configurables, avec heure et durée par défaut), des repas avec un nombre de portions. Colonne « Jour (estimé) » : calories, protéines et coût du jour ; coût de la période sous le tableau.
- **Liste de courses** générée pour la même période (`shared/quantities.ts`) : quantités de chaque repas ajustées aux portions planifiées (la recette est écrite pour son propre nombre de portions), additionnées par ingrédient avec conversion des unités compatibles (g ↔ kg, ml ↔ cl ↔ l ; et **pièce ↔ poids** quand l'ingrédient a un poids d'une pièce : « 3,5 pièces (≈ 525 g) » ; sans poids, les unités restent à part : « 2 pièces + 10 g »), regroupées par rayon. **Coût estimé** de la liste : sur les quantités utilisées, pas sur les paquets ; repas + **extras qui ont un prix** (le détail repas / extras est affiché, un extra sans prix est nommé et non compté). Plus les **extras** : articles hors repas, à prendre parmi les extras habituels (un clic ; leur prix et leur rayon sont repris) ou tapés à la main, chacun avec un **prix facultatif** modifiable dans la liste. Liste cochable (coche affichée tout de suite, annulée avec un message si l'enregistrement échoue), « Tout décocher », **Copier** (texte) et **Exporter (Markdown)…** (« Enregistrer sous »).
- **Une liste par période** : les coches appartiennent à la liste, pas à l'ingrédient. Changer de période donne une liste propre ; l'ancienne va dans **« Listes précédentes »** si quelque chose y a été coché ou ajouté (sinon elle n'est pas gardée : les repas restent dans le planning) ; revenir sur une période de l'historique rouvre sa liste telle quelle. Une liste précédente se consulte (telle qu'elle était, avec son coût) et se **reprend comme base** : ses articles absents de la liste en cours y sont ajoutés en extras.
- **Résumé de la semaine** (la période choisie) : moyennes par jour (calories, protéines, coût ; sur les jours qui ont des repas), coût total, graphes protéines et calories par jour, tableau par jour (calories, protéines, glucides, lipides, fibres, coût) avec totaux, repas planifiés les plus et les moins protéinés (par portion). **Objectifs facultatifs** (protéines / jour, calories / jour, budget / semaine, ramené à la durée de la période) : trait sur le graphe, ▲ / ▼ par jour. Valeurs incomplètes signalées (ingrédients sans données, unité qui ne se convertit pas). Que des chiffres, **aucun conseil**.
- **Importer / exporter** (JSON, format ci-dessous) : aperçu **avant** d'écrire (à ajouter, déjà là identiques, à fusionner avec la liste des différences, erreurs avec leur ligne) ; un élément déjà là n'est changé que si on le coche (et une confirmation) ; les ingrédients des recettes absents du catalogue sont proposés à la création (décochés = la recette n'est pas importée) ; **sauvegarde de la base** juste avant l'import (`ctx.db.backup`). Export complet dans le même format (aller-retour sans perte, testé). « Télécharger l'exemple… » et une aide du format dans l'onglet.
- **Carte d'accueil** : repas planifiés aujourd'hui.

## Format JSON (import / export)

Avec des préparations (v0.27) : l'exemple de la bolognaise, la sauce préparée à l'avance, les pâtes et le parmesan au moment du repas.

```json
{
  "format": "toolbox-courses",
  "version": 1,
  "ingredients": [
    { "name": "Viande hachée 5 %", "unit": "g" },
    { "name": "Coulis de tomate", "unit": "g" },
    { "name": "Oignon", "unit": "pièce", "pieceWeightG": 150 },
    { "name": "Pâtes", "unit": "g" },
    { "name": "Parmesan", "unit": "g" }
  ],
  "preparations": [
    {
      "name": "Sauce bolognaise",
      "ingredients": [
        { "name": "Viande hachée 5 %", "qty": 125, "unit": "g" },
        { "name": "Coulis de tomate", "qty": 175, "unit": "g" },
        { "name": "Oignon", "qty": 0.375, "unit": "pièce" }
      ],
      "fridgeDays": 3,
      "freezable": true,
      "freezerDays": 90,
      "note": "Mijoter 1 h."
    }
  ],
  "recipes": [
    {
      "name": "Bolognaise",
      "servings": 4,
      "tags": ["batch"],
      "ingredients": [
        { "prep": "Sauce bolognaise", "qty": 4 },
        { "name": "Pâtes", "qty": 400, "unit": "g" },
        { "name": "Parmesan", "qty": 40, "unit": "g" }
      ]
    }
  ]
}
```

Sans préparation, le format d'avant :

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
- **Préparation** (v0.27, tableau racine `preparations`, facultatif) : `name`, `ingredients` : la composition pour **une portion** (`{ name, qty, unit }`, ingrédients seulement), `fridgeDays`, `freezable`, `freezerDays`, `note` (tous facultatifs, mêmes règles que les recettes). **Ligne préparation** d'une recette : `{ "prep": "<nom>", "qty": <portions pour toute la recette> }`. Aperçu : préparations à ajouter / identiques / à fusionner (différences décochées par défaut ; si elle est utilisée, les recettes dont les apports et listes changeraient sont nommées, et rappelées dans la confirmation). Ingrédient inconnu dans une préparation : proposé à la création comme dans les recettes (décoché = la préparation, et les recettes qui en dépendent, ne sont pas importées). Recette qui nomme une préparation absente du fichier et de ToolBox : **erreur avec sa ligne**, la recette n'est pas importée. Recette déjà là dont la structure diffère (préparations ↔ lignes directes) : « structure différente, même dépliage » ou « structure et dépliage différents (…) » avec les différences d'ingrédients, décochée par défaut. L'export écrit `preparations` (seulement s'il y en a : sans préparation, le fichier est exactement celui d'avant) et les lignes préparation.
- **Image** : clé `image` absente ou `"image": null` : l'image déjà là n'est jamais touchée (même pour une recette remplacée) ; il n'y a pas de moyen de retirer une image par le fichier (le faire dans la fiche).
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
- **Par préparation (v0.27)** : l'unité du calcul est le couple (préparation, repas coché) ; un repas d'une recette sans préparation est un couple (bloc, repas), comme en v0.26. Portions de préparation d'un repas = quantité de la ligne × portions planifiées / portions de la recette. Fenêtres, règle de créneau, décongélation et sessions avant la période : identiques, avec la conservation de **sa** préparation. Objectifs dans l'ordre : le plus de couples couverts, le moins de sessions, le moins de cuissons (une cuisson = (session, préparation) : le riz de plusieurs recettes cuit une fois), le moins de portions congelées, le plus proche. Les lignes directes d'une recette découpée (« au moment du repas ») n'apparaissent pas. Résultat par session : « Riz cuit — 3,6 portions (Riz basmati 360 g) → frigo, dont 1 au congélateur », « Utilisée dans » replié ; pas d'horaires, pas d'assemblage, pas de rappel par repas. Couples non couverts : regroupés par préparation, avec la raison. Préparation sans conservation : signalée (« compléter la fiche ») et exclue. **Décongélation** (plans validés seulement) : une ligne par jour dans le planning, « À décongeler : riz cuit, sauce bolognaise ». **Bandeau** d'un plan validé : aussi quand une recette couverte est découpée, ou qu'une préparation utilisée change de composition, de part dans la recette, ou est retirée (chaque portion validée garde ce sur quoi elle a été calculée). Les plans v0.26 restent valables tels quels. Mesures : une semaine, quatre moments, tous les créneaux, toutes les recettes découpées : 2 ms ; deux semaines, conservation d'un jour, 56 couples : ≤ 0,3 s.
- **Pourrait aussi servir (v0.28)** : sous chaque cuisson de la proposition, ligne « pour : mar. soir (Chili) · ven. soir (Bolognaise) — congélateur, sortir la veille », puis les repas planifiés **non cochés** pour cette préparation (ou cette recette entière), pas déjà couverts par un plan validé, que **cette cuisson** peut couvrir avec les mêmes règles (`optionOf` : créneau, frigo ; congélateur seulement avec la congélation et une préparation congelable, jamais mangé le jour de la cuisson). Repas de la période, ou des N jours avant elle. **Gain pur** : seulement une cuisson déjà là ; jamais de session, de cuisson ni de créneau en plus ; correspondance par préparation, jamais par ingrédient brut (du riz en ligne directe n'est pas du « Riz cuit »). Un couple possible sous deux cuissons n'est proposé qu'une fois (sans congélateur d'abord, puis la plus proche). Bloc ouvert s'il y a des suggestions, rien sinon. **Ajouter** / **Tout ajouter** : le repas rejoint cette cuisson (quantités et ligne « pour » mises à jour, sans recalcul, par la même fonction que le serveur), et l'étape 1 l'inclut pour cette préparation seulement (« Riz cuit seulement », case indéterminée). **Retirer** : exactement l'état d'avant. Rien n'est écrit avant « Valider ce plan » ; la validation enregistre la proposition affichée (le serveur vérifie chaque ajout, sinon « La proposition a changé : recalcule. »). Recalculer après des ajouts les traite comme des couples cochés : jamais plus de sessions ni de cuissons (prouvé, et vérifié sur 300 semaines générées).
- **Inclusion par préparation (v0.28)** : l'étape 1 coche des couples (repas, préparation) ; repas entier = toutes ses préparations, décoché = aucune, partiel = affiché (« Riz cuit seulement »). La couverture d'un plan validé est par préparation (une portion d'une recette entière, dont les plans v0.26, couvre tout le repas) : une partie couverte est signalée (« Riz cuit déjà couvert »), les autres restent cochables. Quand N > 0, les repas des N jours avant la période sont listés (rubrique « Avant la période »), jamais pré-cochés (ni par « Tout » ni par le tag).
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

**Migration 5 (v0.27)** : tables et colonnes ajoutées seulement, aucune ligne existante modifiée : `courses__preps` (nom, note, conservation), `courses__prep_items` (préparation, ingrédient, quantité pour une portion, unité, position), `courses__meal_preps` (recette, préparation **par UUID**, portions pour toute la recette, position) ; colonnes `position` sur `courses__meal_items` (vide pour les lignes d'avant : ordre de création), `prep_id` et `basis` (JSON : portions cuites, part de la préparation, composition au moment de la validation) sur `courses__batch_portions` (vides pour un plan v0.26). UUID, dates, suppression logique, journal.

**Historique des listes** : une liste fermée (« Listes précédentes ») est un instantané figé, elle ne change pas quand une préparation change ; la liste en cours, et une période de l'historique rouverte, sont recalculées (comme avant v0.27). L'avertissement de modification d'une préparation le dit.

**Ingrédients** : il n'y a pas de suppression d'ingrédient, seulement la **fusion** ; elle déplace aussi les lignes des préparations. La colonne « Repas » compte les lignes du dépliage et précise « dont prép. : N » ; le survol et la confirmation de fusion listent les recettes et les préparations concernées.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

Chaque repas planifié = un événement « Soir : Risotto » à l'heure et pour la durée par défaut de son moment, avec ses portions. Chaque session d'un plan de batch cooking **validé** = un événement « Batch cooking : Curry, Dal » (sur la journée tant qu'aucune heure n'est donnée).

## API

| Méthode               | Route                                                                             | Rôle                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET                   | `/state` · `/home` · `/list/text`                                                 | Tout (ingrédients, repas, moments, planning et liste de la période) · accueil · texte à copier                                         |
| POST · PATCH          | `/ingredients` · `/ingredients/:id` · `/ingredients/merge`                        | Ingrédients, fusion                                                                                                                    |
| POST · PUT · DELETE   | `/meals` · `/meals/:id` (+ `/restore`)                                            | Repas (dont `fridgeDays`, `freezable`, `freezerDays`)                                                                                  |
| POST · PUT · DELETE   | `/preps` · `/preps/:id` (+ `/restore`)                                            | Préparations (PUT refusé, 409, si la composition d'une préparation utilisée change sans `confirmed`) ; suppression refusée si utilisée |
| POST                  | `/meals/:id/extract` · `/meals/:id/inline`                                        | « Extraire en préparation » (`apply` false = aperçu) · « Remplacer par ses ingrédients »                                               |
| GET · PUT · POST      | `/batch?from&to` · `/batch/grid` · `/batch/grid/model`                            | Batch : repas, grille et plans · grille de la période · « Retenir comme habituels »                                                    |
| POST                  | `/batch/compute` · `/batch/plans`                                                 | Proposer (n'écrit rien) · valider un plan                                                                                              |
| DELETE · PATCH        | `/batch/plans/:id` · `/batch/sessions/:id`                                        | Annuler un plan · heure et durée d'une session                                                                                         |
| PUT · DELETE          | `/meals/:id/image` `{ path }` ou `{ data }`                                       | Image du repas : ajouter / remplacer, retirer (ancienne à la Corbeille)                                                                |
| PUT                   | `/moments`                                                                        | Moments (un moment encore planifié ne se retire pas)                                                                                   |
| POST · PATCH · DELETE | `/plan` · `/plan/:id`                                                             | Planning                                                                                                                               |
| PUT · POST            | `/list` · `/list/check` · `/list/uncheck-all` · `/list/extras` · `/list/export`   | Période, coches, extras, export                                                                                                        |
| POST · PATCH · DELETE | `/extras` · `/extras/:id` · `/list/extras/:id`                                    | Extras habituels (rayon, prix) · quantité et prix d'un extra de la liste                                                               |
| GET · POST            | `/lists/history` · `/lists/:id/reuse`                                             | Listes précédentes · reprendre comme base                                                                                              |
| GET · PUT             | `/summary` · `/goals`                                                             | Résumé de la période · objectifs                                                                                                       |
| POST                  | `/import/preview` · `/import/apply` `{ text, overwrite, replaceRecipes, create }` | Aperçu (n'écrit rien) · import confirmé (sauvegarde avant)                                                                             |
| POST · GET            | `/export-json` · `/example-json`                                                  | Export complet · exemple (« Enregistrer sous » en POST)                                                                                |

## Tests

`tests/quantities.test.ts` (conversions, unités incompatibles, portions, affichage), `tests/nutrition.test.ts` (conversions, nutrition et coût avec manques, pièces ↔ poids dans la liste), `tests/exchange.test.ts` (lecture, erreurs et leurs lignes, aperçu), `tests/commands.test.ts`, `tests/meal-filter.test.ts` (filtres communs à l'onglet Repas et au sélecteur du planning), `tests/keeping.test.ts` (migration 4 sans changement des données, conservation éditée, ancien JSON sans les champs, différences dans l'aperçu), `tests/batch.test.ts` (optimisation : une session, deux, congélation, non congelable, soir / midi, plusieurs créneaux le même jour, raisons, jamais congelé le jour même, déterminisme, au-delà du budget ; grille : modèle projeté, N jours avant, « Retenir comme habituels »), `tests/batch-form.test.ts` (pré-cochage, cochés à la main, raccourcis, conservation manquante), `tests/batch-plans.test.ts` (grille d'une période et modèle, moment renommé ou supprimé, calcul sans écriture, deux plans, refus d'un chevauchement, annulation, rappels, calendrier, bandeau, N = 0 / 2, avertissement d'une autre période), `tests/regression.test.ts` (**non-régression** : une base réaliste construite par l'API, tout ce qui est calculé depuis les ingrédients des recettes comparé à la référence `tests/fixtures/regression.json` écrite par le code v0.26.0), `tests/recipe.test.ts` (dépliage : recette mixte, décimales, même ingrédient direct et dans une préparation, servings 4 × 4 → 2 portions ; extraction et remplacement identiques ; ligatures), `tests/preps.test.ts` (liste et apports exacts, extraction aperçu / application / préparation existante / 3 portions, remplacement, avertissement, refus de suppression, nom déjà pris, ingrédient utilisé seulement dans une préparation et fusion, migration 5), `tests/batch-suggest.test.ts` (suggestions : fenêtre frigo, congélateur seulement si activé et congelable, jamais une cuisson absente, règle de créneau, une seule fois au bon endroit ; Ajouter et Retirer exacts ; garantie sur 300 semaines générées), `tests/batch-suggest-api.test.ts` (préparation partagée suggérée, ingrédient brut non, recette entière, validation avec ajouts et refus d'un ajout étranger, couverture partielle, repas avant la période), `tests/batch-preps.test.ts` (bolognaise : la sauce sans les pâtes ; frigo et congélateur pour une même préparation ; riz partagé cuit une fois ; œufs non congelables ; préparation sans conservation ; bandeau après découpage ou changement de composition ; plan v0.26 toujours valable ; mesures de temps), `tests/exchange-preps.test.ts` (fichier avec préparations, préparation inconnue avec sa ligne, structure différente (les deux messages), préparation modifiée et recettes touchées, `image` absente et `null`, aller-retour : base strictement identique), `tests/images.test.ts` (réduction, JPEG, refus, URL `data:`), `tests/solid.test.ts` (migration 3 sans perte, valeurs écrites une par une, prix des extras dans le coût, lecture de la nutrition et du coût par l'assistant, images : ajout, refus, remplacement vers la Corbeille, retrait, export et import avec une image valide et une invalide), `tests/module.test.ts` (démarrage vide, aperçu sans écriture, import seulement de ce qui est confirmé, sauvegarde, aller-retour export → import → export identique, une liste par période et historique, reprendre comme base, résumé et objectifs, socle réel : doublons refusés, repas, planning sur une période, liste additionnée et convertie, hors période ignoré, fusion, extras, coches, texte, source du calendrier, droit de l'assistant).

## Limites connues

- Batch cooking : les portions congelées d'une période précédente ne sont pas réutilisées ; au-delà d'environ deux semaines avec tous les créneaux cochés, le calcul exact peut refuser (décocher des créneaux).

- Pas d'arrondi « à l'achat » (paquets) ; pas de conversion g ↔ ml (densité) ni pour les cuillères.
