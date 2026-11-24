# 0064 — Coffre : gérer l'arbre des contextes (déplacer, fusionner, supprimer, réordonner)

- Statut : acceptée (v0.48.0, marqué « Expérimental »)
- Date : 24/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règles 2 et 11), ADR 0052, ADR 0055

## Contexte

Pour Thomas, un contexte est un **chemin de rangement**. Jusqu'en v0.47, on pouvait le renommer (son dossier suivait) mais ni le déplacer sous un autre, ni le fusionner, ni le supprimer proprement : trois contextes créés à la racine ne pouvaient pas passer sous « Cours » sans l'explorateur Windows.

## Décision

- **Le dossier du coffre reproduit exactement l'arbre des contextes** (règle 2) : chaque action déplace les fichiers sur le PC **d'un bloc**, puis les fiches.
- **Déplacer** (`POST /contexts/:id/move { parentId }`, `null` = racine) :
  - le dossier du contexte est renommé vers sa nouvelle place, puis les chemins de tous les éléments dessous (archivés compris, et la provenance des éléments à la corbeille) sont réécrits dans une transaction ;
  - refusé dans lui-même ou un de ses descendants, et quand un contexte de même nom existe déjà à la destination (« fusionne-les plutôt ») ;
  - refusé aussi quand un dossier de même nom existe sans être un contexte : la correspondance dossier ↔ contexte n'est jamais cassée.
- **Fusionner** (`POST /contexts/:id/merge { into }`) :
  - les éléments passent dans la destination, sous un nom libre (`nom (2)`, jamais d'écrasement) ;
  - les sous-contextes de même nom sont fusionnés récursivement, les autres déplacés dessous ;
  - les liens « aussi utilisé dans » suivent (jamais en double) ; les règles apprises qui visaient la source visent la destination ; le lien au cours et la couverture sont repris s'ils manquaient ;
  - la source est supprimée (suppression logique) et son dossier retiré **seulement s'il est vide**.
- **Supprimer** (`DELETE /contexts/:id`) : seulement un contexte vide (ni élément, ni lien, ni sous-contexte) ; sinon un refus clair (l'interface propose « Déplacer son contenu vers… », c'est-à-dire fusionner). Jamais de suppression d'éléments.
- **Renommer** (`PATCH /contexts/:id { name }`) : même journal, donc annulable ; un changement de casse seul passe par un nom temporaire (Windows ne distingue pas les majuscules).
- **Route nouvelle** : « Déplacer dans… » accepte une route (`newParent: ["Cours", "Semestre 2"]`) ; les contextes manquants sont créés **à la validation** et retirés par « Annuler ».
- **Noms** : un nouveau nom de contexte doit être un nom de dossier Windows valide tel quel (`invalidName`) : sinon un refus clair, plutôt qu'un dossier au nom différent du contexte.
- **Réordonner** les frères (`POST /contexts/:id/reorder { beforeId }`).
- **Journal d'opérations** : chaque pas (renommage de dossier, déplacement de fichier, fiche modifiée) enregistre son inverse ; un échec en cours de route défait tout ce qui a été fait ; **« Annuler »** (15 min) rejoue le même journal à l'envers : l'arbre et les fichiers d'avant, exactement.
- Refusé pendant qu'une opération tourne sur le disque (mise à jour, vérification).
- **Disque** : rien à faire de spécial. Chaque élément dont le chemin a changé devient un **déplacement** dans le plan de la prochaine mise à jour (rien n'est recopié ; testé : 4 éléments → 4 déplacements, 0 copie).

## Conséquences

- Recherche, vues par attribut, « Maintenant » et règles apprises restent justes (ils lisent les fiches, pas les chemins).
- Correction au passage : le renommage filtrait les chemins avec `LIKE` (où `_` est un joker) ; il compare maintenant le préfixe exact.
