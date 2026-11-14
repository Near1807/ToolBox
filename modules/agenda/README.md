# Agenda (`agenda`)

La semaine d'un coup d'œil, rapide à remplir, reliée aux autres outils. Portable (PC et téléphone), « Prêt pour la synchro », « Prêt pour le calendrier ». **Expérimental** (v0.34.0).

## Deux types d'éléments, chacun à sa place

1. **Événements** à heure fixe (« dentiste jeudi 14h 1h ») ou sur la journée, éventuellement sur plusieurs jours (« week-end scout 13-15 février », « examen math 18 janvier ») : ils vivent dans l'Agenda.
2. **Choses à faire sans heure** : ce sont les tâches de la To-do. L'Agenda les **affiche** dans « À caser » (échéance, durée estimée), il ne crée pas de deuxième liste. Une chose à caser écrite dans la barre (« préparer la réunion ~1h avant vendredi ») devient une tâche de la To-do (service `todo`, facultatif : sans To-do, « À caser » est masqué et la barre le dit).

Plus la **semaine type** (comme au Sport) : cours, entraînements, réunions fixes, qui reviennent chaque semaine sur leur période. Une seule occurrence peut être annulée ou déplacée (d'une semaine au plus), sans toucher les autres.

## La barre de saisie

Une barre en français, avec aperçu avant validation (« Sera ajouté : Dentiste · jeu. 19 nov. 14:00–15:00 ») ; analyse pure dans `shared/parse.ts`, dates de la To-do (`@hub/sdk/dates`, partagées, jamais copiées).

| Écrit                                                                | Devient                                 |
| -------------------------------------------------------------------- | --------------------------------------- |
| `dentiste jeudi 14h 1h`                                              | événement jeudi 14:00–15:00             |
| `réunion staff mardi 20h`                                            | événement 20:00–21:00 (1 h par défaut)  |
| `cours de solfège de 18h à 19h30 lundi`, `répétition 14h-16h samedi` | événement de 18:00 à 19:30              |
| `week-end scout 13-15 février`, `camp du 30 janvier au 2 février`    | sur la journée, plusieurs jours         |
| `examen math 18 janvier`                                             | sur la journée                          |
| `badminton tous les jeudis 19h 2h`, `réunion chaque mardi 20h`       | semaine type (à partir d'aujourd'hui)   |
| `préparer la réunion ~1h avant vendredi`, `acheter du pain`          | tâche de la To-do, à caser              |
| `réviser stats ~2h mercredi 14h` (v0.35.0)                           | tâche de la To-do **prévue** mer. 14:00 |
| `#cours`, `#examens`… n'importe où                                   | la catégorie                            |

Règles : une **durée avec « ~ »** fait une tâche (une heure qui finit cette phrase est son heure prévue, « avant … » son échéance, un jour seul son échéance, v0.35.0) ; sinon une **heure** fait un événement à cette heure (aujourd'hui si aucune date), une **date seule** un événement sur la journée, **rien de daté** une tâche. La date et les heures viennent après le titre. Après une heure, une longueur sans « ~ » (« 1h », « 30min », « pendant 1h30 ») est la durée (10 h au plus : « 14h 16h » n'est pas 16 heures). Le formulaire détaillé existe aussi, jamais obligatoire.

## Vue de la semaine (PC)

Colonnes par jour, heures de la journée (réglage « Début / Fin de la journée », 7 h – 23 h par défaut), blocs colorés par catégorie (`--series-1…8` des thèmes, `shared/categories.ts`), aujourd'hui mis en avant ; rangée du haut pour les événements sur la journée et sur plusieurs jours ; bande « À caser » (tâches échues cette semaine, rangées par échéance, puis celles sans échéance, repliables) ; sous chaque jour une **barre de charge** découpée par catégorie (heures d'événements + durées estimées des tâches échues ce jour-là) et un état léger / chargé / saturé ; en tête « X h de libre · Y h à caser · + N tâches sans durée » ; chevauchements signalés ; **interrupteurs de catégorie** (v0.35.0, voir plus bas) ; vue mois légère. Calculs purs dans `shared/load.ts`.

**Charge** (catégories allumées seulement) : heures des événements et des tâches prévues dans la plage de la journée, par catégorie, plus les durées estimées des tâches échues ce jour-là (« Tâches » ; une tâche en retard pèse sur aujourd'hui, jamais sur un jour passé ni sur une semaine suivante). Léger sous 50 % de la plage, chargé sous 85 %, saturé au-delà. Les événements sur la journée (un camp, un examen) n'ont pas d'heures : ils ne pèsent pas. **Libre** : la plage moins les événements (chevauchements comptés une fois). **À caser** : les durées estimées des tâches qui pèsent sur un jour de la semaine (celles en retard dans la semaine en cours) ; les tâches sans échéance sont dans la bande, pas dans ce total.

## Agir sur place (v0.36.0, Expérimental)

- **Fiche complète d'une tâche** : un clic sur une tâche prévue (semaine, jour, mois) ou à caser ouvre la fiche **prêtée par la To-do** (`todo.taskEditor`, ADR 0046). Elle contient :
  - tous les champs (titre, tags, échéance, durée estimée, heure prévue, morceau), avec le formulaire et les vérifications de la To-do, sans copie ;
  - « Faite », « Retirer de l'agenda », « Supprimer » (confirmation puis « Annuler »), « Ouvrir dans la To-do ».

  Chaque changement s'affiche dans la semaine, avec « Annuler » (les valeurs d'avant réécrites).

- **Cocher** : une case sur chaque bloc de tâche (et sur sa ligne dans la vue jour). Cochée, la tâche est barrée ; « Annuler » juste après. Route `PUT /tasks/:id/done` → service `todo`.
- **Créer dans un trou** :
  - PC : clic sur un créneau vide → saisie ancrée là, jour et heure au quart d'heure, 30 min ; glisser sur une plage vide → cette durée ;
  - téléphone, vue jour : les créneaux libres (30 min au moins) sont listés, toucher l'un d'eux ouvre la même saisie ;
  - deux choix : **« Tâche »** (tâche de la To-do prévue à ce moment, durée de la plage ; Entrée) ou **« Rendez-vous »** (événement de l'Agenda) ;
  - aperçu avant de créer, Échap annule, rien n'est créé avant le choix ; « Annuler » après.

  Routes `POST /tasks` et `DELETE /tasks/:id` (pour « Annuler » seulement) → service `todo`. Calculs purs : `slotSpan` (`shared/drag.ts`), `freeGaps` (`shared/load.ts`).

- **Panneau d'un événement** : tous les champs modifiables directement (plus d'étape « Modifier »), « Enregistrer » avec « Annuler ». Une occurrence de la semaine type garde ses actions « cette fois-ci ».

## Timer depuis l'Agenda (v0.36.0, Expérimental)

- « Lancer un timer » (composant prêté par le Timer, absent sans lui) :
  - dans la fiche d'une tâche : la session est liée à la tâche ;
  - dans le panneau d'un rendez-vous : la session porte son titre et la référence `agenda:event:<id>` (une occurrence de la semaine type : `agenda:weekly:<id>:<date>`).
- Le choix proposé : durée du bloc, pomodoro, préréglages.
- **Timer associé** :
  - gardé par l'événement ou par l'élément de la semaine type (`timer_pref`, migration 3, synchronisé ; pour la semaine type, il vaut pour toutes les semaines) ;
  - pour une tâche, gardé par la To-do.
- Le bloc dont le timer tourne a une petite icône ⏱ (semaine et vue jour). `RangeDto.timer` est lu par le service `timer` (facultatif) ; la page se rafraîchit chaque minute tant qu'un timer tourne.

## Barre « Ajouter » (v0.36.0)

Destination **« Rendez-vous »** de la barre « Ajouter » du shell (ADR 0046). Elle suit les règles de la barre de l'Agenda (`appointmentPreview`, `shared/parse.ts`) : un événement ou une entrée de la semaine type. Une phrase de tâche (« ~ », ou rien de daté) est refusée avec « Tab pour choisir Tâche ». « Annuler » supprime l'ajout, « Ouvrir » montre son jour.

## Interrupteurs de catégorie (v0.35.0, Expérimental)

Les calques de v0.34 deviennent des **interrupteurs** : une catégorie **allumée** est affichée **et comptée** (charge, temps libre, chevauchements, « à caser » pour « Tâches ») ; **éteinte**, elle n'est ni affichée ni comptée (remplace la règle « la charge compte toujours tout »).

- **Par défaut éteintes** : Sport, Repas (repas et batch), Timer — les choses de tous les jours. **Allumées** : les catégories de l'Agenda, Tâches, Musique. Liste de départ modifiable : réglage « Catégories éteintes par défaut » (`categoriesOff`, « Sport, Repas, Timer »), lu dans `RangeDto.categoriesOff`.
- Choix **propre à chaque appareil** (`localStorage`, `toolbox.agenda.categorySwitches`, jamais synchronisé) ; les calques masqués en v0.34 sont repris comme éteints.
- Le bilan de la semaine dit ce qui n'est pas compté (« hors Sport, Repas »).
- Règle pure : `isOn(catégorie, choix, éteintes par défaut)` (`shared/categories.ts`), comptage par `timedBlocks(data, shown)` et `taskLoads(data, shown)` (`frontend/common.ts`), testés (`tests/layers.test.ts`).

## Tâches prévues et glisser-déposer (v0.35.0, Expérimental)

Une tâche reste **une donnée de la To-do** : l'Agenda la lit par le calendrier (un événement de la To-do avec `itemId`, ADR 0045) et la modifie **par le service `todo`** (`planTask`), jamais par une copie. Tout changement d'un côté se voit de l'autre, sur le PC et le téléphone (champs synchronisés de la To-do).

- **PC, glisser-déposer** (calculs purs dans `shared/drag.ts`, testés) :
  - une tâche de « À caser » → la grille : prévue ce jour, à cette heure, magnétisme au quart d'heure, pour sa durée estimée (30 min sans durée, et la durée estimée prend cette valeur) ;
  - un bloc (tâche prévue ou événement de l'Agenda) → une autre heure ou un autre jour (sa durée gardée) ;
  - le **bas** d'un bloc → sa durée (15 min au moins ; pour une tâche, sa durée estimée) ;
  - une **occurrence de la semaine type** : cette fois-ci seulement (l'exception existante) ;
  - les éléments des autres modules (Sport, Repas, Timer, Musique) ne se déplacent pas : curseur et infobulle le disent, un clic les ouvre dans leur outil ;
  - les événements sur la journée ou sur plusieurs jours : pas dans cette version.

  Pendant le glisser : aperçu de l'heure de début et de fin, **Échap** annule. **Rien n'est écrit pendant le glisser : une seule écriture au dépôt**, puis « Annuler » (les valeurs d'avant réécrites).

- **Détail d'une tâche prévue** (clic, PC et téléphone) : jour, heure, durée, « Retirer de l'agenda » (retour dans « À caser »), « Ouvrir dans la To-do ». Cochée : barrée, toujours là. Prévue après son échéance : signalée.
- **Téléphone** : pas de glisser ; heure et durée se changent par le détail (tâche et événement).
- Route : `PUT /tasks/:id/plan { plannedAt?, durationMin? }` (`plannedAt: null` = retirer de l'agenda) → service `todo`.

## Données (« Prêt pour la synchro », MODULES.md §6 bis)

| Élément      | Détail                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tables       | `agenda__events` (titre, `start_at`, `end_at` : dates pour la journée, dernier jour inclus ; date-heures sinon ; `all_day`, lieu, note, catégorie) · `agenda__weekly` (titre, jour 0 = lundi, heure, durée, catégorie, lieu, `valid_from`, `valid_until`) · `agenda__exceptions` (occurrence annulée ou déplacée : `weekly_id`, `occurrence_date`, `kind`, nouveau début et durée) · `agenda__changes` |
| Synchro      | `sync: {}` et migration 2 `syncJournalSql` : tout voyage entre le PC et le téléphone. Une seule exception vivante par occurrence (les précédentes passent en suppression logique ; si deux appareils en écrivent une, la plus récente compte)                                                                                                                                                          |
| Suppressions | logiques, « Annuler » (`/restore`)                                                                                                                                                                                                                                                                                                                                                                     |
| Fichiers     | aucun                                                                                                                                                                                                                                                                                                                                                                                                  |
| Facultatif   | `todo` (« À caser », la barre ajoute des tâches)                                                                                                                                                                                                                                                                                                                                                       |

Les autres modules sont **lus** par `ctx.calendar.query` (jamais écrits) ; ceux qui donnent des éléments à caser (la To-do) ne sont pas affichés deux fois.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

Ses événements et les occurrences de la semaine type, catégorie comprise ; `endDate` pour ceux sur plusieurs jours ; le lieu en `status`. Lecture seule.

## API

`GET /range?from&to` (62 jours au plus ; `tasks` = tâches prévues, v0.35.0) · `POST /quick { text }` · `PUT /tasks/:id/plan` · `PUT /tasks/:id/done` · `POST /tasks` · `DELETE /tasks/:id` · `POST /events` · `PATCH /events/:id` · `DELETE /events/:id` · `POST /events/:id/restore` · `POST /weekly` · `PATCH /weekly/:id` · `DELETE /weekly/:id` · `POST /weekly/:id/restore` · `PUT /weekly/:id/occurrences/:date { action: cancel | move | reset, start, durationMin }` · `GET /today`.

## Pas dans cette version

Rappels et notifications (consultation seulement).
