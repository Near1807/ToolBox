# To-do (`todo`)

Tes tâches, simples : titre, tags, échéance facultative en langage naturel, case « Fait ». Une tâche peut être rattachée à un morceau de la Bibliothèque (« finir le mix de boumboum » apparaît aussi sur la fiche du morceau). Section **Outils**. Pilotable à la voix par l'assistant.

## Ce qu'il fait

- **Ajout rapide au clavier** : une ligne, puis Entrée. « finir le mix #mix vendredi » donne la tâche « finir le mix », le tag `mix` et l'échéance vendredi. Un aperçu montre ce qui sera ajouté avant de valider ; « ce n'est pas une date » garde la fin dans le titre. Les tags existants sont proposés sous le champ (clic = ajouté). Le morceau se choisit à côté, si la Bibliothèque est là.
- **Échéances comprises** (code testé, `dates.ts`) :
  - « aujourd'hui », « ce soir », « demain (matin) », « après-demain » ;
  - « vendredi » (le prochain : dit un vendredi, c'est celui de la semaine suivante), « vendredi prochain » (celui de la semaine prochaine), « lundi en huit » ;
  - « dans 3 jours », « dans une semaine », « dans quinze jours » (14 jours), « dans un mois » ;
  - « la semaine prochaine » (lundi), « cette semaine » / « d'ici la fin de la semaine » (vendredi), « ce week-end » (samedi), « fin du mois », « le mois prochain » (le 1er) ;
  - « le 12 », « le 12 novembre », « le premier décembre », « vendredi 30 », « 12/11 », « 12/11/2026 », « 2026-11-12 ».

  Ce qui n'est pas compris est refusé avec un message ; rien n'est deviné.

- **Vues** : « À faire » (par échéance, sans échéance à la fin) et « Faites » (les plus récentes d'abord), filtre par tag (menu, ou clic sur un tag). Les tâches **en retard** ont un liseré et un badge rouges ; « Aujourd'hui » en orange.
- **Modification sur place** : clic sur le titre (Entrée pour valider, Échap pour annuler) ; ✎ pour les tags, l'échéance (en langage naturel, avec l'aperçu de la date) et le morceau.
- **Suppression** avec confirmation, puis **« Annuler »** pendant quelques secondes ; « Annuler » aussi après un ajout.
- **Accueil** : widget « à faire aujourd'hui » (retards compris).
- **Fiche du morceau** (Bibliothèque) : ligne « To-do : 2 à faire : finir le mix (vendredi) · … ».
- **Timer** (si le module est là) : bouton ⏱ « Lancer un timer » sur chaque tâche à faire (ouvre le Timer avec la tâche choisie) et temps de travail passé dessus (« ⏱ 1 h 05 »). À la fin d'une session, « Tâche terminée ? » → « Oui » coche la tâche (clic de l'utilisateur, dans le Timer).

## Durée estimée (v0.34.0)

Champ facultatif d'une tâche, en minutes, affiché discrètement (« ~2 h ») à côté de l'échéance ; modifiable dans le détail (crayon : « 2h », « 30min », « 1h30 »). Dans la saisie rapide, elle s'écrit **toujours avec « ~ » devant**, pour ne jamais se confondre avec une heure : « réviser les maths ~2h vendredi », « ranger le studio ~30min ». « 14h » reste du texte (une heure, pas une durée). Formes comprises après « ~ » : `2h`, `2 h`, `1h30`, `1 h 30`, `1,5h`, `45min`, `45 min`, `90 minutes`, `2 heures` (5 jours au plus). L'aperçu montre « Sera ajouté : … · ~2 h ». Donnée par l'API (`durationMin`), le service `todo` (`TodoTask.durationMin`, `createTask({ durationMin })`) ; colonne synchronisée comme les autres. Fonctions pures : `parseDuration`, `formatDuration`, `takeDuration` (`dates.ts`).

## Heure prévue (v0.35.0, Expérimental)

Champ facultatif « **prévu le … à …** » (`planned_at`, « AAAA-MM-JJTHH:MM ») : quand faire la tâche, distinct de l'échéance (« avant vendredi ») ; une tâche peut avoir l'un, l'autre, les deux ou aucun. Une tâche prévue est un bloc dans la semaine de l'Agenda, de la longueur de sa durée estimée ; placée **sans** durée estimée, elle prend **30 min**, et sa durée estimée prend cette valeur (modifiable).

- **Saisie rapide** (règle décidée avec Thomas) : une **heure qui finit la phrase**, avec ou sans jour autour, est l'heure prévue.

  | Écrit                                                                    | Devient                                             |
  | ------------------------------------------------------------------------ | --------------------------------------------------- |
  | `appeler Paul 14h`                                                       | prévue aujourd'hui 14:00, ~30 min                   |
  | `appeler Paul demain 14h`, `rdv 14h demain`, `appeler Paul demain à 14h` | prévue demain 14:00                                 |
  | `réviser stats ~2h mercredi 14h`                                         | prévue mer. 14:00, ~2 h                             |
  | `préparer ~1h jeudi 9h avant vendredi`                                   | prévue jeu. 9:00, échéance vendredi                 |
  | `réviser stats ~2h mercredi`                                             | **échéance** mercredi (un jour seul garde son sens) |
  | `réunion 14h avec Léa`, `acheter du pain avant 19h`                      | titre complet (heure au milieu, ou après « avant ») |

  **Changement de sens par rapport à v0.34 (choisi par Thomas)** : `appeler Paul 14h` donnait la tâche « appeler Paul 14h » sans date ; c'est maintenant « appeler Paul » prévue à 14:00. L'aperçu le montre, et « ce n'est pas une heure » garde tout le texte en titre.

- **Détail** (crayon) : champs « Prévu le » et « à », bouton « **Retirer de l'agenda** » (efface l'heure ; la tâche revient dans « À caser » de l'Agenda, sa durée estimée reste).
- **Liste** : « mer. 18 nov. 14:00 » à côté de la durée. Une tâche **prévue après son échéance** est signalée (« après l'échéance »), jamais bloquée.
- **Agenda** : il lit la tâche par le calendrier et la change par le service (`planTask`) : déplacer ou étirer son bloc change l'heure ou la durée **de la tâche**, dans les deux sens, sur le PC et le téléphone (champ synchronisé).

## Fiche prêtée (v0.36.0)

La To-do **prête sa fiche de tâche** aux autres modules : `provides: { 'todo.taskEditor': TaskEditor }`, props `TaskEditorProps` dans `contract.ts` (ADR 0046). L'Agenda l'affiche quand on clique une tâche.

- C'est le même formulaire que le crayon de la liste (`frontend/TaskFields.tsx`), plus le titre, « Faite », « Supprimer » (confirmation, puis « Annuler ») et « Ouvrir dans la To-do ».
- La fiche tourne dans le contexte de la To-do et n'écrit que par ses routes.
- Chaque changement rend à l'emprunteur un message et son annulation (les valeurs d'avant réécrites).

**Timer** (v0.36.0) : la fiche contient « Lancer un timer » (composant prêté par le Timer, absent sans lui), lié à la tâche. Le **timer associé** est gardé par la tâche : `timer_pref`, migration 6, champ synchronisé, `timerPref` dans l'API, un petit objet donné par le Timer et gardé tel quel.

Service : `deleteTask(id)`, ajouté seulement pour l'« Annuler » d'une création faite par un autre module sur un clic (« Tâche » dans un créneau de l'Agenda).

## Barre « Ajouter » (v0.36.0)

Destination **« Tâche »** (la première, celle par défaut) de la barre « Ajouter » du shell (ADR 0046) : mêmes règles que l'ajout rapide (tags, échéance, durée « ~ », heure prévue), aperçu par `taskPreview` (`shared.ts`), « Annuler » supprime la tâche ajoutée.

## Assistant (actions, MODULES.md §5.15)

| Action          | Risque                      | Rôle                                                                                                                                                            |
| --------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add-task`      | modification (annulable)    | `title`, `tags`, `due` (tel que dit : « vendredi »), `track` (nom approximatif : « boumboum ») ; refuse une échéance ou un morceau pas clair, avec une question |
| `list-tasks`    | lecture                     | `filter` : à faire (défaut), aujourd'hui (retards compris), en retard, 7 prochains jours, faites, toutes ; `tag`, `track`                                       |
| `complete-task` | modification (annulable)    | `task` : titre approximatif ou numéro ; plusieurs tâches possibles → il demande laquelle                                                                        |
| `delete-task`   | destructrice (confirmation) | « Je supprime la tâche « … » ? » avant ; annulable                                                                                                              |
| `list-tags`     | lecture                     | tags existants (pour réutiliser le bon)                                                                                                                         |

**Droits (désactivés par défaut)** : `todo.edit-tasks` « L’assistant peut ajouter et cocher des tâches » (`add-task`, `complete-task`) et `todo.delete-tasks` « L’assistant peut supprimer des tâches » (`delete-task`, toujours après un « oui »). Réglages › Droits de l’assistant vocal.

**Commandes standardisées** (`backend/commands.ts`, testées dans `tests/commands.test.ts`) : phrases d'exemple et extracteurs en code pour `add-task` (titre, tags, échéance lue par le parseur de dates, morceau après « sur le morceau »), `list-tasks` (aujourd'hui, semaine, en retard, faites, toutes ; tag), `complete-task` et `delete-task` (la tâche, retrouvée ensuite par son nom approximatif). `list-tags` reste pour l'IA seulement.

## Données

| Élément        | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table          | `todo__tasks` (id UUID, titre, tags JSON, `due_date` AAAA-MM-JJ, `done_at`, `created_at`, `updated_at`, `deleted_at`, `subject` = `music-library:track:<id>` ou vide, `legacy_id`, `duration_min` = durée estimée en minutes ou vide, migration 4, v0.34.0 ; `planned_at` = heure prévue ou vide, migration 5, v0.35.0 ; `timer_pref` = timer associé ou vide, migration 6, v0.36.0) · `todo__changes` · `todo__legacy_ids` · `todo__tasks_v1` (avant v0.25, intacte)                                                                                                                                                           |
| Fichiers       | aucun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Réglages       | aucun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Service fourni | `todo` (`contract.ts`) : `listOpenTasks()`, `getTask(id)`, `completeTask(id)`, `uncompleteTask(id)`, `createTask(fields)` (dont `plannedAt`), `planTask(id, { plannedAt, durationMin })` (v0.35.0, l'Agenda : sur un dépôt ou « Retirer de l'agenda » de l'utilisateur, avec « Annuler »), `deleteTask(id)` (v0.36.0, « Annuler » d'une création) — utilisé par le Timer et la Boîte à idées (« Transformer en tâche ») ; `completeTask`, `uncompleteTask` et `createTask` seulement sur un clic de l'utilisateur dans le module appelant (`uncompleteTask` : pour annuler une coche faite par ce module, « Annuler » du Timer) |
| Bibliothèque   | ligne « To-do » sur la fiche du morceau (`registerTrackInfo`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Prêt pour la synchro** (MODULES.md §6 bis) depuis v0.25 : UUID, `created_at` / `updated_at`, suppression logique (`deleted_at`), journal `todo__changes` (`SyncStore`). Migration 2 : l'ancienne table numérotée est gardée telle quelle en `todo__tasks_v1`, chaque ligne copiée avec les mêmes valeurs et dates ; nouvel id = `legacyId('todo:task', ancien numéro)`, ancien numéro dans `legacy_id`, paires dans `todo__legacy_ids`. Une tâche supprimée reste en base (suppression logique) : « Annuler » la rétablit, même après un redémarrage. Les ids sont des UUID (le Timer et la Boîte à idées référencent une tâche par son UUID, `contract.ts`) ; l'assistant comprend encore « la tâche 3 » pour une tâche numérotée avant v0.25. Si son morceau est supprimé de la Bibliothèque, la tâche reste, sans lien.

## Dépendances

Aucune obligatoire. Facultatives : `musicLibrary` (rattacher un morceau) et `timer` (temps passé, bouton « Lancer un timer » ; les deux modules s'utilisent l'un l'autre en facultatif, le service est donc demandé au moment de l'utiliser). Sans elles, tout marche sauf ces liens.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

`ctx.calendar` : chaque tâche avec une échéance = un événement sur la journée (titre, état « à faire », « en retard » ou « fait », lien `/m/todo`). v0.34.0 : les tâches à faire non prévues sont des éléments à caser (`unscheduled`). v0.35.0 : chaque tâche **prévue** = un événement à son heure, pour sa durée, avec `itemId` (l'id de la tâche) ; cochée, elle reste (« fait ») ; prévue après son échéance : état « après l'échéance ». Lecture seule ; l'Agenda modifie par le service.

## API

| Méthode | Route                                    | Rôle                                                                                                                        |
| ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/tasks`                                 | Tâches (triées, avec `timeSpent` en secondes), tags avec leur nombre, morceaux de la Bibliothèque, `timer` (module présent) |
| POST    | `/tasks`                                 | `{ title, tags?, due? (AAAA-MM-JJ ou langage naturel), trackId?, durationMin?, plannedAt? }`                                |
| PATCH   | `/tasks/:id`                             | `{ title?, tags?, due?, done?, trackId?, durationMin?, plannedAt? }` (`null` efface ; `plannedAt` « AAAA-MM-JJTHH:MM »)     |
| DELETE  | `/tasks/:id` · POST `/tasks/:id/restore` | Supprime · « Annuler » (dans l'heure)                                                                                       |
| GET     | `/today`                                 | Widget : tâches dues aujourd'hui ou en retard, nombre de tâches à faire                                                     |
