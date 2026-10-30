# Module modèle (`_template`)

Exemple complet et minimal d'un module, **à copier** pour créer un nouvel outil (voir [`docs/AJOUTER-UN-MODULE.md`](../../docs/AJOUTER-UN-MODULE.md)).

Le dossier commence par `_` : c'est un **module d'exemple**, ignoré par défaut. Il n'est chargé que par le smoke test de la CI ou avec la variable `TOOLBOX_LOAD_EXAMPLES=1` : `TOOLBOX_LOAD_EXAMPLES=1 npm run dev` (bash) ou `$env:TOOLBOX_LOAD_EXAMPLES=1; npm run dev` (PowerShell).

## Ce qu'il fait

Icône : `puzzle` (un nom du jeu d'icônes du SDK, `packages/sdk/icons.tsx` ; pas d'emoji dans l'interface, `docs/MODULES.md` §7.1).

Une liste de notes, l'export d'une note en fichier .txt (enregistré dans `ctx.outputs` : listé, supprimable, signalé s'il disparaît du disque), un message d'accueil réglable, une tâche longue de démonstration avec progression et annulation, et une tâche planifiée quotidienne.

## Données

| Élément          | Détail                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table            | `template__notes` (id, text, created_at) — migration 1                                                                                                                       |
| Fichiers         | exports `Note <id>.txt` dans le dossier de sortie, enregistrés dans `ctx.outputs` (ref `note:<id>`, projet `_template:note:<id>`)                                            |
| Réglages         | `greeting` (texte), `demoSeconds` (nombre)                                                                                                                                   |
| Événements émis  | `template:note.created` `{ id }`                                                                                                                                             |
| Services fournis | aucun                                                                                                                                                                        |
| Assistant        | `count-notes` (lecture), `add-note` (modification, annulable, droit `template.edit-notes` désactivé par défaut) ; phrases d'exemple et extracteurs (commandes standardisées) |

## Dépendances

Aucune.

## API

| Méthode | Route                                    | Rôle                                     |
| ------- | ---------------------------------------- | ---------------------------------------- |
| GET     | `/api/modules/template/notes`            | Liste des notes                          |
| POST    | `/api/modules/template/notes`            | Crée une note `{ text }`                 |
| DELETE  | `/api/modules/template/notes/:id`        | Supprime une note                        |
| POST    | `/api/modules/template/notes/:id/export` | Exporte la note en .txt (fichier généré) |
| GET     | `/api/modules/template/summary`          | Nombre de notes et message d'accueil     |
| POST    | `/api/modules/template/demo-job`         | Lance la tâche de démonstration          |
