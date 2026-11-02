# 0043 — Batch en deux temps : éléments de base et doubles doses

- Statut : acceptée (remplace la partie « Pourrait aussi servir » de l'ADR 0042)
- Date : 2026-11-02

## Contexte

Le batch mélangeait deux pratiques : préparer d'avance en session des éléments qui reviennent (riz, œufs durs), et cuisiner plus au moment d'un repas pour un repas suivant (gratin × 2). Elles coexistent et s'emboîtent (riz en session, sauce du curry en double dose).

## Décision

- **Temps 1** : l'étape 1 liste des éléments (préparation ou recette non découpée), pas des repas ; un élément coché couvre tous ses repas, chacun excluable. Moteur exact (`planBatch`) inchangé. Pré-cochage par les éléments du dernier plan validé (réglage caché) ; le tag « batch » ne pré-coche plus rien. Les suggestions v0.28 sont retirées.
- **Temps 2** : `doubleDoses` (`shared/batch-cook.ts`), sur les couples non couverts : pour chaque élément, le premier repas non couvert à un moment où Thomas cuisine ouvre une cuisson qui couvre les repas suivants dans la fenêtre (`optionOf`, mêmes règles que le temps 1). Pour les repas qu'il couvre, c'est le moins de cuissons : chaque cuisson s'ouvre au premier repas encore non couvert, et une cuisson ouverte plus tard porte au moins aussi loin. Vérifié contre une recherche exhaustive. Une cuisson d'un seul repas n'est pas listée.
- **Validation** : la page envoie les doubles doses gardées et exclues ; le serveur refait le calcul et refuse si la liste ne correspond plus. Une double dose est stockée comme une session de type `double` à son repas (migration 6, colonne `kind`, ajout seul) : la couverture, la décongélation et le bandeau marchent sans changement ; le calendrier ne montre que les sessions.

## Conséquences

- Un repas qu'une cuisson ouverte à un repas déjà couvert pourrait atteindre n'est pas proposé (l'algorithme ouvre au premier repas non couvert, comme demandé).
- Un plan sans session (seulement des doubles doses) est possible ; sans créneau coché, le temps 1 ne propose rien (ce n'est plus une erreur).
