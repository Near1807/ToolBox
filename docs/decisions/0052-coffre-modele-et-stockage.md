# 0052 — Coffre : éléments, contextes, attributs, et le disque lisible sans ToolBox

- Statut : acceptée (v0.45.0, module marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md`

## Contexte

Thomas veut un endroit unique pour ses fichiers, où ranger ne coûte presque rien et où retrouver est immédiat. Deux besoins tirent en sens contraire. Le disque doit rester lisible sans ToolBox (un arbre de dossiers). Il faut aussi retrouver un fichier par ce qu'il **est** (« tout mon Python », « les supports de PCH »), dans tous les contextes.

## Décision

1. **Un contexte = la maison de l'élément** : arbre peu profond (`coffre__contexts`, `parent_id`), un seul par élément, qui décide de l'emplacement sur le disque (`userData/coffre/Cours/Thermo/fichier.pdf`). Un élément peut être « aussi utilisé » ailleurs (`coffre__also`) : un lien, jamais une copie.
2. **Les attributs ne sont pas dans le chemin** (`coffre__attributes` : clé, valeur, origine « deviné » / « choisi », raison) : changer la nature ou le langage ne déplace rien ; chaque attribut est une facette (pastilles combinables, vue par attribut). Une valeur choisie n'est jamais remplacée par une déduction (`mergeGuesses`).
3. **Trois sortes d'éléments** (`coffre__items.kind`) : fichier, projet (dossier entier, empreinte = sha256 des chemins relatifs et contenus), lien externe (laissé à sa place, non sauvegardé, marqué partout).
4. **Copier, jamais déplacer l'original** ; la copie est relue (empreinte identique) avant que la fiche existe ; un dépôt est tout ou rien (copies retirées en cas d'échec). Un changement de contexte déplace le fichier puis écrit la fiche ; si la fiche échoue, le fichier revient.
5. **Noms Windows** (`shared/names.ts`) : caractères interdits, noms réservés, longueur, et collision → « nom (2) », jamais un remplacement.
6. **Corbeille du coffre** : `_Corbeille/<id>/`, Annuler ; l'effacement définitif est une action à part, confirmée, depuis la corbeille seulement. Arrivée : `_Arrivée/`, jamais une erreur.
7. **Prêt pour la synchro** (UUID, dates, suppressions logiques, journal `coffre__changes`) sans synchro réelle ; module **PC seulement** (`PC_ONLY_MODULES`).
8. **Cours de l'Agenda** : lus par un service en lecture seule de l'Agenda, `agenda.courses()` (dépendance facultative), pour reconnaître un cours dans un nom de fichier.

## Conséquences

- Renommer un contexte renomme son dossier et met à jour les chemins de ses éléments (une transaction, retour arrière si la base échoue).
- La palette des catégories de l'Agenda passe dans le SDK (`@hub/sdk/palette`) pour être partagée ; l'Agenda la ré-exporte (rien ne change pour lui).
- v0.46 ajoutera le disque externe (états, archives, historique) sur ce même modèle.
