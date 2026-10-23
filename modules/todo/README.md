# To-do (`todo`)

Tes tâches, simples : titre, tags, échéance facultative en langage naturel, case « Fait ». Une tâche peut être rattachée à un morceau de la Bibliothèque (« finir le mix de boumboum » apparaît aussi sur la fiche du morceau). Section **Outils**. Pilotable à la voix par l'assistant.

## Ce qu'il fait

- **Ajout rapide au clavier** : une ligne, puis Entrée. « finir le mix #mix vendredi » donne la tâche « finir le mix », le tag `mix` et l'échéance vendredi. Un aperçu montre ce qui sera ajouté avant de valider ; « ce n'est pas une date » garde la fin dans le titre. Les tags existants sont proposés sous le champ (clic = ajouté). Le morceau se choisit à côté, si la Bibliothèque est là.
- **Échéances comprises** (code testé, `dates.ts`) :
  - « aujourd'hui », « ce soir », « demain (matin) », « après-demain » ;
  - « vendredi » (le prochain, aujourd'hui si on est vendredi), « vendredi prochain » (celui de la semaine prochaine), « lundi en huit » ;
  - « dans 3 jours », « dans une semaine », « dans quinze jours » (14 jours), « dans un mois » ;
  - « la semaine prochaine » (lundi), « cette semaine » / « d'ici la fin de la semaine » (vendredi), « ce week-end » (samedi), « fin du mois », « le mois prochain » (le 1er) ;
  - « le 12 », « le 12 novembre », « le premier décembre », « vendredi 30 », « 12/11 », « 12/11/2026 », « 2026-11-12 ».

  Ce qui n'est pas compris est refusé avec un message ; rien n'est deviné.

- **Vues** : « À faire » (par échéance, sans échéance à la fin) et « Faites » (les plus récentes d'abord), filtre par tag (menu, ou clic sur un tag). Les tâches **en retard** ont un liseré et un badge rouges ; « Aujourd'hui » en orange.
- **Modification sur place** : clic sur le titre (Entrée pour valider, Échap pour annuler) ; ✎ pour les tags, l'échéance (en langage naturel, avec l'aperçu de la date) et le morceau.
- **Suppression** avec confirmation, puis **« Annuler »** pendant quelques secondes ; « Annuler » aussi après un ajout.
- **Accueil** : widget « à faire aujourd'hui » (retards compris).
- **Fiche du morceau** (Bibliothèque) : ligne « To-do : 2 à faire : finir le mix (vendredi) · … ».

## Assistant (actions, MODULES.md §5.15)

| Action          | Risque                      | Rôle                                                                                                                                                            |
| --------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add-task`      | modification (annulable)    | `title`, `tags`, `due` (tel que dit : « vendredi »), `track` (nom approximatif : « boumboum ») ; refuse une échéance ou un morceau pas clair, avec une question |
| `list-tasks`    | lecture                     | `filter` : à faire (défaut), aujourd'hui (retards compris), en retard, 7 prochains jours, faites, toutes ; `tag`, `track`                                       |
| `complete-task` | modification (annulable)    | `task` : titre approximatif ou numéro ; plusieurs tâches possibles → il demande laquelle                                                                        |
| `delete-task`   | destructrice (confirmation) | « Je supprime la tâche « … » ? » avant ; annulable                                                                                                              |
| `list-tags`     | lecture                     | tags existants (pour réutiliser le bon)                                                                                                                         |

## Données

| Élément        | Détail                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Table          | `todo__tasks` (titre, tags JSON, `due_date` AAAA-MM-JJ, `done_at`, `created_at`, `updated_at`, `subject` = `music-library:track:<id>` ou vide) — migration 1 |
| Fichiers       | aucun                                                                                                                                                        |
| Réglages       | aucun                                                                                                                                                        |
| Service fourni | aucun                                                                                                                                                        |
| Bibliothèque   | ligne « To-do » sur la fiche du morceau (`registerTrackInfo`)                                                                                                |

Une tâche supprimée est gardée en mémoire une heure pour « Annuler » (pas en base). Si son morceau est supprimé de la Bibliothèque, la tâche reste, sans lien.

## Dépendances

Aucune obligatoire. Facultative : `musicLibrary` (rattacher un morceau). Sans elle, tout marche sauf le rattachement.

## API

| Méthode | Route                                    | Rôle                                                                    |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| GET     | `/tasks`                                 | Tâches (triées), tags avec leur nombre, morceaux de la Bibliothèque     |
| POST    | `/tasks`                                 | `{ title, tags?, due? (AAAA-MM-JJ ou langage naturel), trackId? }`      |
| PATCH   | `/tasks/:id`                             | `{ title?, tags?, due?, done?, trackId? }` (`null` efface)              |
| DELETE  | `/tasks/:id` · POST `/tasks/:id/restore` | Supprime · « Annuler » (dans l'heure)                                   |
| GET     | `/today`                                 | Widget : tâches dues aujourd'hui ou en retard, nombre de tâches à faire |
