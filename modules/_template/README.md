# Module modèle (`_template`)

Exemple complet et minimal d'un module, **à copier** pour créer un nouvel outil (voir [`docs/AJOUTER-UN-MODULE.md`](../../docs/AJOUTER-UN-MODULE.md)).

Le dossier commence par `_` : c'est un **module d'exemple**, ignoré par défaut. Il n'est chargé que par le smoke test de la CI ou avec la variable `TOOLBOX_LOAD_EXAMPLES=1` : `TOOLBOX_LOAD_EXAMPLES=1 npm run dev` (bash) ou `$env:TOOLBOX_LOAD_EXAMPLES=1; npm run dev` (PowerShell).

## Ce qu'il fait

Une liste de notes, un message d'accueil réglable, une tâche longue de démonstration avec progression et annulation, et une tâche planifiée quotidienne.

## Données

| Élément          | Détail                                                 |
| ---------------- | ------------------------------------------------------ |
| Table            | `template__notes` (id, text, created_at) — migration 1 |
| Fichiers         | aucun                                                  |
| Réglages         | `greeting` (texte), `demoSeconds` (nombre)             |
| Événements émis  | `template:note.created` `{ id }`                       |
| Services fournis | aucun                                                  |

## Dépendances

Aucune.

## API

| Méthode | Route                             | Rôle                                 |
| ------- | --------------------------------- | ------------------------------------ |
| GET     | `/api/modules/template/notes`     | Liste des notes                      |
| POST    | `/api/modules/template/notes`     | Crée une note `{ text }`             |
| DELETE  | `/api/modules/template/notes/:id` | Supprime une note                    |
| GET     | `/api/modules/template/summary`   | Nombre de notes et message d'accueil |
| POST    | `/api/modules/template/demo-job`  | Lance la tâche de démonstration      |
