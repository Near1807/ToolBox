# 0040 — Batch cooking : un calcul exact qui propose, des plans validés qui ne touchent à rien

- Statut : acceptée
- Date : 2026-11-01

## Contexte

Thomas veut préparer à l'avance des repas de son planning, quel que soit son mode de vie : aucun jour, aucun horaire, aucune habitude ne doivent être supposés. Il veut le vrai optimum (pas une heuristique approximative) et garder la main : rien ne doit modifier son planning, ses listes ni ses portions.

## Décision

- **Données** : la conservation est portée par la recette (jours au frigo, congelable, jours au congélateur), vide par défaut, jamais proposée. Migration 4 : colonnes ajoutées, aucune ligne existante modifiée ; tables de grilles, plans, sessions et portions « Prêtes pour la synchro ».
- **Créneaux** : grille jour × moment. Modèle habituel dans un réglage caché, indexé par jour de la semaine et **identifiant** de moment ; grille propre à chaque période ; le modèle ne change que par « Retenir comme habituels ». Sessions avant la période seulement si N > 0 (réglage, 0 par défaut).
- **Calcul exact** (`shared/batch.ts`, pur) : toutes les couvertures minimales sont trouvées par une recherche qui branche sur les créneaux pouvant couvrir le premier repas non couvert, puis départagées selon l'ordre demandé (repas couverts, sessions, cuissons, portions congelées, proximité). Entrées triées : résultat déterministe. Un budget de recherche borne le temps ; au-delà, **aucun plan** plutôt qu'un plan approximatif. Mesures : deux semaines avec tous les créneaux cochés ≤ 0,2 s ; trois semaines entièrement cochées dépassent le budget (refus en < 1,5 s).
- **Contrôle** : le calcul ne se lance qu'au clic et n'écrit rien. « Valider ce plan » enregistre le plan (et la grille utilisée) ; seulement alors les rappels « sortir du congélateur » (lecture seule) et les sessions du calendrier existent. Plusieurs plans par période, jamais sur les mêmes repas. Planning changé : bandeau, aucun recalcul automatique.

## Conséquences

- Les portions congelées d'une période précédente ne sont pas réutilisées (limite connue, documentée).
- Si les périodes longues entièrement cochées deviennent un besoin, il faudra une autre méthode exacte (programmation linéaire en nombres entiers, ou découpage par jours), à décider avec Thomas avant tout code : aucune heuristique sans son accord.
