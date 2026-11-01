# 0041 — Préparations : une seule fonction de dépliage, et le batch par préparation

- Statut : acceptée
- Date : 2026-11-01

## Contexte

Le batch cooking v0.26 raisonnait par recette entière, ce qui est faux en pratique : une bolognaise, c'est une sauce (préparée à l'avance, congelable) et des pâtes (cuites le jour même) ; des œufs durs tiennent au frigo mais ne se congèlent pas ; le riz cuit d'une session sert à plusieurs recettes. Le bon niveau est la **préparation**, avec sa propre composition et sa propre conservation, réutilisable (comme une fiche technique en restauration). Thomas exige que rien ne change pour les outils existants (apports, listes, prix, résumé, historique, assistant, import / export d'un ancien fichier).

## Décision

- **Modèle** : une préparation (nom unique, comparé sans casse, accents ni ligatures) a une composition **pour une portion** (ingrédients seulement, un seul niveau, pas de cycle), une conservation (vide par défaut) et une note. Une ligne de recette est un ingrédient ou une préparation × portions ; ces portions décrivent ce qu'il faut pour **toute** la recette, exactement comme une ligne d'ingrédient.
- **Une seule fonction de dépliage** (`shared/recipe.ts`, `expandRecipe`) : lignes directes + ingrédients de chaque préparation × ses portions. Le serveur la passe une fois pour toutes dans `MealDto.items`, que lisent déjà tous les calculs (nutrition, coût, liste, résumé, historique, assistant, filtres, batch). Seuls l'éditeur de recette et l'import / export lisent la structure brute (`MealDto.lines`). Inventaire des lecteurs : rapport v0.27.0.
- **Précision** : les quantités venant d'une préparation sont des produits (quantité pour une portion × portions) arrondis à 9 décimales dans le calcul (jamais en base), pour que 500 / 3 × 3 donne 500. « Extraire en préparation » et « Remplacer par ses ingrédients » sont vérifiés par le serveur : le dépliage reste strictement le même, sinon rien n'est fait.
- **Batch** : l'unité est le couple (préparation, repas) ; une recette sans préparation reste un bloc (comportement v0.26). Une cuisson est (session, préparation) : le riz de deux recettes est cuit une fois. Mêmes fenêtres, même recherche exacte, même ordre des objectifs. Les portions validées gardent ce sur quoi elles ont été calculées (`basis`) pour signaler un changement (recette découpée, préparation modifiée ou retirée).
- **Migration 5** : tables et colonnes ajoutées seulement ; un plan v0.26 reste valable tel quel.

## Conséquences

- Les directes d'une recette découpée sont « au moment du repas » et n'apparaissent pas dans le batch.
- La conservation d'une recette découpée reste en base mais n'a plus d'effet (dit dans l'éditeur).
- Il n'existe pas de suppression d'ingrédient (seulement la fusion) : la fusion déplace aussi les lignes des préparations.
