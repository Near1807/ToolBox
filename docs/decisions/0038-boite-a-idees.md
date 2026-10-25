# 0038 — Boîte à idées : un module à part, pas une variante de la To-do

- Statut : acceptée
- Date : 2026-10-24

## Contexte

Thomas veut noter des idées (musique, clips, visuels…) sans qu'elles deviennent des tâches : pas d'échéance, pas de case « Fait », du texte libre, des tags, et les retrouver ou en tirer une au hasard. Certaines idées deviennent ensuite du travail à faire.

## Décision

- **Nouveau module `ideas`** (section Outils), sans dépendance obligatoire ; Bibliothèque et To-do en services facultatifs, demandés au moment de l'usage.
- **Deux tables du module** (`ideas__ideas`, `ideas__tags`), dans `hub.db` donc dans les sauvegardes. Les tags restent une liste JSON sur l'idée (comme la To-do) ; la table des tags ne garde que les couleurs. Renommer ou fusionner réécrit les idées concernées dans une transaction.
- **Texte en mise en forme simple** analysée par une fonction pure (`shared.ts`) et rendue en éléments React : gras, italique, listes, liens http(s). Jamais de HTML injecté.
- **Recherche côté serveur, pure et testée** : accents et majuscules ignorés, tous les mots requis ; filtre multi-tags en « et ». Le volume visé (quelques centaines d'idées) ne justifie pas d'index plein texte SQLite.
- **« Transformer en tâche »** passe par un nouveau `createTask` du service `todo`, appelé seulement sur un clic ; l'idée garde la trace (id et titre de la tâche) et n'est pas supprimée.
- **Assistant** : ajout derrière un droit propre (« L'assistant peut ajouter des idées »), désactivé par défaut ; lecture libre. La To-do refuse désormais « note une idée … » pour ne pas en faire une tâche. Le masquage des paramètres de la reconnaissance retire aussi les tags écrits « #tag » (sinon « idée : … #tag » n'était pas reconnue ; « ajoute une tâche … #studio … » y gagne aussi).
- **Suppression** : confirmation puis « Annuler » gardé en mémoire (comme la To-do) ; l'export Markdown passe par « Enregistrer sous ».

## Conséquences

- Une idée et la tâche qui en est née vivent séparément : modifier l'une ne change pas l'autre.
- La couleur d'un tag est propre à la Boîte à idées (les tags de la To-do n'ont pas de couleur).
