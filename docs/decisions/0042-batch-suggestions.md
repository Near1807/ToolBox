# 0042 — Batch : « Pourrait aussi servir », un gain pur, et l'inclusion par préparation

- Statut : acceptée
- Date : 2026-11-01

## Contexte

Une proposition de batch prévoit des cuissons (« Riz cuit, lundi midi »). D'autres repas planifiés, non cochés, utilisent peut-être la même préparation dans sa fenêtre de conservation : en faire davantage pendant la même cuisson ne coûte rien. Thomas veut que l'outil les suggère, sans jamais rien ajouter qui coûte (session, cuisson, créneau) et sans rien écrire avant la validation.

## Décision

- **Gain pur** : une suggestion n'agrandit qu'une cuisson déjà dans la proposition (même session, même préparation ou même recette entière). Jamais de nouvelle session, jamais de nouvelle cuisson, jamais un autre créneau. Correspondance par préparation (ou recette entière identique) seulement, jamais par ingrédient brut.
- **Mêmes règles que le calcul** : une seule fonction (`optionOf`, `shared/batch.ts`) dit si un créneau couvre un couple (règle de créneau, fenêtre frigo, fenêtre congélateur seulement avec la congélation et une préparation congelable, jamais mangé le jour de la cuisson). Un couple que plusieurs cuissons pourraient prendre n'est suggéré qu'une fois : sans congélateur d'abord, puis la plus proche, puis la session la plus tôt.
- **Ajouter / Retirer sans recalcul** : la page garde la proposition calculée et la liste des ajouts ; ce qu'elle affiche est `withAdditions(proposition, ajouts)`. Retirer = la même proposition avec un ajout de moins, donc exactement l'état d'avant. Les quantités sont recalculées par la même fonction que le serveur (`cookIngredients`). La validation renvoie les ajouts ; le serveur refait le calcul, vérifie que chaque ajout est une suggestion de cette proposition (sinon 409, rien n'est écrit) et enregistre la proposition affichée.
- **Inclusion par préparation** : l'étape 1 coche des couples (repas, préparation). Repas entier = toutes ses préparations ; un ajout l'inclut pour cette préparation seulement (« Riz cuit seulement »). La couverture d'un plan validé est elle aussi par couple ; une portion d'une recette entière (dont tous les plans v0.26) couvre le repas entier.
- **Repas des jours avant la période** : listés à l'étape 1 quand des sessions peuvent être avant la période (N > 0), jamais pré-cochés.
- **Garantie** : recalculer après des ajouts ne donne jamais plus de sessions ni de cuissons. Raison : la proposition agrandie couvre tout avec les mêmes sessions et cuissons, un sur-ensemble ne demande pas moins de sessions, et la recherche exacte trouve toutes les couvertures minimales. Vérifié sur 300 semaines générées.

## Conséquences

- La ligne « pour : mar. soir (Chili) · … » revient sous chaque cuisson (choix de Thomas), à la place de « Utilisée dans ».
- Un plan v0.27 qui couvrait un repas sans toutes ses préparations (conservation manquante) laisse désormais les autres préparations cochables.
