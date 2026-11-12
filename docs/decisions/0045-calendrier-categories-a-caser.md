# 0045 — Calendrier : catégories, plusieurs jours, éléments à caser

- Statut : **accepté** (12/11/2026, demande de Thomas, session v0.34.0)
- Date : 2026-11-12
- Complète : MODULES.md §5.17 (« Prêt pour le calendrier »)

## Contexte

Le registre `ctx.calendar` (v0.25) réunit les éléments datés de Sport, Courses, Planning de sortie, To-do et Timer, en lecture seule, par `GET /api/core/calendar`. Le nouveau module **Agenda** les affiche avec ses propres événements. Il a besoin :

- d'une catégorie lisible par élément, pour colorer les blocs, faire des calques et découper la charge ;
- d'événements « sur la journée » qui durent plusieurs jours (camp, examens) ;
- des **choses à faire sans heure** (les tâches de la To-do), qui ne sont pas des événements : elles n'ont ni heure ni durée imposée, seulement une échéance et une durée estimée facultatives.

## Décision

1. **Ajouts seulement, tous facultatifs** : `CalendarSource.category`, `CalendarEvent.category`, `CalendarEvent.endDate` (dernier jour inclus d'un événement sur la journée), `CalendarSource.unscheduled(from, to)` qui rend des `CalendarItem` (échéance et durée estimée facultatives).
2. **Lecture enrichie pour les modules** : `ctx.calendar.query(from, to)` rend `{ events, items }`, chaque élément avec son `moduleId` et sa `category` (celle de l'événement, sinon celle de la source, sinon le nom du module). Une source en erreur est écartée, les autres répondent.
3. **`GET /api/core/calendar` reste identique** (aucun champ ajouté par le socle) : les références de non-régression de Sport, To-do et Timer l'utilisent.
4. **Les tâches ne deviennent pas des événements** : la To-do les fournit en `unscheduled` (à faire, échéance au plus tard la fin de la période ou sans échéance). L'Agenda ne crée jamais une deuxième liste : une chose « à caser » saisie dans l'Agenda devient une tâche de la To-do (service `todo`, facultatif).
5. **Analyse des dates partagée** : `modules/todo/dates.ts` devient `@hub/sdk/dates` (mêmes fonctions, même code), utilisé par la To-do et l'Agenda, jamais copié.

## Conséquences

- Les fournisseurs existants marchent sans changement. Ils ont reçu une catégorie de source (« Sport », « Repas », « Musique », « Tâches », « Timer ») ; leurs événements et leurs références ne changent pas.
- Un futur module daté donne sa catégorie et, s'il a des choses à faire sans heure, `unscheduled`.
- Le module téléphone a le même registre (`backend/core/calendar.ts`, portable).

## Complément v0.35.0 : une tâche placée à une heure

Thomas veut placer une tâche dans la semaine (glisser, ou « prévu le … à … ») sans qu'elle devienne une copie : la tâche reste une donnée de la To-do (`planned_at`, migration 5), que l'Agenda modifie par le service `todo` (`planTask`).

- **Ajout seulement** : `CalendarEvent.itemId` (facultatif). La To-do donne chaque tâche prévue comme un **événement** à son heure, pour sa durée estimée (30 min si elle n'en a pas au moment où elle est placée), avec `itemId` = l'id de la tâche ; une tâche cochée reste, état « fait ». Une tâche prévue n'est plus un élément à caser.
- **Lecture** : un lecteur d'éléments (l'Agenda) affiche, pour une source d'éléments, ses événements qui ont un `itemId` et ignore les autres (les échéances, déjà dans « À caser »). Les autres sources ne changent pas.
- `GET /api/core/calendar` garde sa forme ; il rend aussi ces événements (avec `itemId`) quand une tâche est prévue. Les références (aucune tâche prévue) ne changent que par les champs ajoutés, vides.
