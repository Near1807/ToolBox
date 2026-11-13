# Timer (`timer`)

Un timer pour se mettre au travail : **timer simple**, **sessions avec pauses** (pomodoro) et **pomodoro incrémental** (périodes de travail très courtes au début, puis plus longues, pauses constantes) pour briser la barrière du démarrage. Section **Outils**. Inspiré du timer de GameLife : un clic sur une durée pour lancer, un grand anneau, la question « Tâche terminée ? » à la fin. ADR 0035.

## Ce qu'il fait

- **Timer simple** : une durée au choix (chips 10 à 60 min, un clic lance ; ou « Autre durée »), pause / reprendre / arrêter, +5 min, temps restant en grand.
- **Pomodoro** : travail, pause, et soit un nombre de cycles, soit une durée totale (« 2 h ») ; pause longue facultative tous les N cycles. Enchaînement automatique travail → pause → travail ; « Passer la pause », « +5 min ».
- **Pomodoro incrémental** : travail de départ (ex. 5 min), progression (+3 min ou +X % par cycle), travail maximal (ex. 25 min), pause constante, cycles ou durée totale.
- **Aperçu avant de lancer** : frise des phases (largeur = durée), durées de travail (« 5 / 8 / 11 / 14 / 17 / 20 / 15 min »), pauses, total, **heure de fin estimée**.
- **Préréglages** enregistrables (« Enregistrer comme préréglage… »), lancés d'un clic, modifiables, supprimables (avec confirmation). Livrés : « Pomodoro classique 25/5 » (4 cycles, pause longue de 15 min tous les 4) et « Démarrage doux 2 h » (5 min +3 min, plafond 25, pause 5, 2 h).
- **Tâche de la To-do** (facultatif) : choisie dans la page, ou bouton ⏱ « Lancer un timer » sur la tâche dans la To-do. À la fin : notification, son, et **« Tâche terminée ? »** : « Oui, la cocher » coche la tâche (ton clic), avec **« Annuler »** juste après (la tâche est décochée, sauf si elle était déjà faite avant, et la question revient ; possible jusqu'au lancement d'une autre session) ; « Non » propose de relancer une session (même programme ou autre durée) ou « Plus tard ».
- **Toujours juste** : le temps est calculé depuis l'heure réelle (début, pauses), jamais par un compteur. Il continue si tu changes de page, et reprend correctement au relancement si l'app était fermée (une session finie pendant la fermeture attend sa question).
- **Fenêtre flottante** (celle du socle, partagée, MODULES.md §5.16 ; par-dessus l'application en cours, ToolBox réduite) : `frontend/Floating.tsx`.
  - mini-timer : phase et temps restant ;
  - changements de phase quelques secondes : « Pause — 5 min », « Au travail — 8 min » (en plus de la notification) ;
  - à la fin, **« Tâche terminée : [titre] ? »** avec « Oui, la cocher » / « Non » : mêmes effets que sur la page (« Oui » coche par le service `todo`, sur ton clic, puis « Cochée : … » avec « Annuler » pendant 8 s) ; « Non » → « Relancer (même programme) » / « Plus tard ». La question reste aussi sur la page du Timer tant qu'elle n'a pas de réponse ; après « Non », « Relancer » est proposé aux deux endroits (gardé en mémoire jusqu'à « Plus tard » ; un redémarrage de l'app vaut « Plus tard »). Sans tâche : « Session terminée » avec « Relancer » / « Fermer ».
  - Chaque élément a son réglage.
- **Historique** : date, session, tâche, travail fait (et prévu si arrêtée), terminée ou arrêtée, réponse à « Tâche terminée ? » ; **temps passé par tâche** (aussi sur la tâche dans la To-do).
- **Accueil** : la session en cours (phase, temps restant), sinon des boutons de lancement rapide (15, 25, 45 min et les deux premiers préréglages).

## Lancer depuis les autres modules (v0.36.0, Expérimental)

Le Timer **prête** le composant `timer.launch` (ADR 0046, props `TimerLaunchProps` dans `contract.ts`) : le bouton « Lancer un timer » de la fiche d'une tâche (To-do, aussi dans l'Agenda) et du panneau d'un rendez-vous de l'Agenda.

- **Choix court** : « durée du bloc » (timer simple de la durée prévue), « pomodoro 25/5 » (4 cycles, les réglages par défaut du Timer), ou un préréglage.
- **Lien** :
  - sur une tâche, la session est **liée à la tâche** : « Tâche terminée ? » la coche, et le temps passé compte pour elle ;
  - sur un rendez-vous, la session porte son titre (« Répétition · Pomodoro 25/5 ») et une **référence générique** `subject` (« agenda:event:<id> »), pour que l'Agenda montre que son timer tourne.
- **Associer** : la case « Associer ce choix » fait retenir le choix par le propriétaire de la tâche ou de l'événement. Ensuite le bouton devient « Lancer : pomodoro 25/5 » en un clic ; on peut changer de choix ou « Ne plus associer ».
- **Un seul timer à la fois** : s'il en tourne un, le menu le nomme ; lancer le nouveau demande une confirmation, puis arrête l'ancien (travail fait compté). Le composant lance par l'API du Timer (`/stop`, `/start`), jamais autrement.
- **Téléphone** : mêmes boutons ; la notification permanente suit toute session, d'où qu'elle soit lancée.

## Réglages

| Réglage              | Défaut       | Effet                                                                                       |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `sound`              | Cloche douce | Son à chaque changement de phase et à la fin : cloche, bips ou aucun                        |
| `volume`             | 70 %         | Volume de ce son                                                                            |
| `notify`             | oui          | Notification Windows à chaque changement de phase                                           |
| `overlay`            | oui          | Mini-timer flottant pendant une session                                                     |
| `overlayQuestion`    | oui          | « Tâche terminée ? » et « Relancer » dans la fenêtre flottante (rien n'est coché sans clic) |
| `overlayTransitions` | oui          | Changements de phase affichés ~5 s dans la fenêtre flottante                                |

## Assistant (actions, MODULES.md §5.15)

| Action         | Risque       | Exemples                                                                    |
| -------------- | ------------ | --------------------------------------------------------------------------- |
| `timer-status` | lecture      | « combien de temps il reste », « où en est le timer »                       |
| `start-timer`  | modification | « lance un timer de 27 minutes sur finir le mix », « minuteur d'une heure » |
| `start-preset` | modification | « lance mon démarrage doux » (seulement un préréglage qui existe)           |
| `pause-timer`  | modification | « pause », « mets le timer en pause » (annulable : reprend)                 |
| `resume-timer` | modification | « reprends le timer »                                                       |
| `stop-timer`   | modification | « arrête le timer » (annulable : la session revient telle quelle)           |
| `skip-break`   | modification | « passe la pause »                                                          |

**Droit (désactivé par défaut)** : `timer.drive-timer` « L'assistant peut piloter le timer », pour toutes les actions qui modifient. Le Timer n'a aucune action qui coche une tâche : cela reste sous le droit `todo.edit-tasks` de la To-do. Durées comprises en code (`backend/commands.ts`) : « 27 minutes », « vingt-sept min », « une heure », « 1 h 30 », « une heure et demie », « une demi-heure », « un quart d'heure », « trois quarts d'heure ».

## Données

| Élément    | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables     | `timer__sessions` (id UUID, programme en phases, tâche liée (UUID) et son titre, `subject` = référence d'un autre module ou vide (migration 4, v0.36.0), état, heure de reprise, temps actif compté, travail fait, réponse, `legacy_id`) · `timer__presets` (id UUID, nom, réglages) · `timer__changes` · `timer__legacy_ids` · `timer__sessions_v1`, `timer__presets_v1` (avant v0.25, intactes). Migration 1 avec les deux préréglages livrés ; migration 2 « Prêt pour la synchro » : mêmes valeurs, la tâche d'une session devient `legacyId('todo:task', n)` (le même UUID que la To-do), donc temps par tâche et « Tâche terminée ? » restent sur la bonne tâche ; un préréglage supprimé, une session annulée par l'assistant : suppression logique |
| Fichiers   | aucun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Service    | `timer` (`contract.ts`) : `timeByTask()`, `current()` (avec `subject` depuis v0.36.0) — utilisé par la To-do et l'Agenda ; composant prêté `timer.launch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Facultatif | `todo` (lier une tâche, « Oui » qui coche) : sans la To-do, tout marche sauf le lien                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Deux appareils (synchro avec le téléphone, v0.33.0)

Une session lancée sur un appareil apparaît sur l'autre après une synchro : même phase, même temps restant (les lignes portent les heures réelles). **Un seul timer à la fois** : si deux tournent (un lancé sur chaque appareil entre deux synchros), le plus récemment lancé gagne ; l'autre est arrêté (« arrêtée » dans l'historique, travail fait compté), listé dans « Conflits » sur les deux appareils, et l'appareil qui l'affichait le dit (« Ton timer … est arrêté : … lancé plus tard sur le PC, a la priorité », bouton OK). Décidé par le PC seul (`syncClock.onReceived`, `tools.master`). Une session arrêtée à la main sur l'autre appareil : « Ton timer … a été arrêté sur le PC / le téléphone ». Avis en mémoire seulement (`GET /notice`, `POST /notice/dismiss`, événement `notice`), aucune colonne ajoutée.

## Notification permanente sur le téléphone (v0.33.0)

Pendant une session, sur le téléphone : une notification qui reste (non balayable) dans le volet et sur l'écran de verrouillage, avec le temps restant de la phase qui défile (compte à rebours natif d'Android) et son nom (`ongoingLabel` : « Travail · cycle 2 sur 4 », « Pause », « Pause longue », « Timer » pour un timer simple). La page donne le **plan complet** (`ongoingPlan`, `shared/notices.ts`) au greffon natif à chaque changement de la session (démarrage, pause, reprise, « +5 min ») ; le greffon passe seul d'une phase à l'autre (AlarmManager), reconstruit la notification après un redémarrage et la retire à la fin. Canal silencieux : le son reste celui des alertes de fin de phase. Ses boutons (« Pause » / « Reprendre », « Arrêter ») ouvrent l'appli, qui fait l'action par le serveur du Timer (seule vérité). Réglage du téléphone « Afficher le timer en cours dans les notifications », activé par défaut, Expérimental.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

`ctx.calendar` : chaque session = un événement à son heure locale de début (nom, tâche liée), durée jusqu'à sa fin (ou, en cours, jusqu'à sa fin prévue), état (« en cours », « en pause », « terminée », « arrêtée »). Lecture seule : interroger le calendrier n'écrit rien.

## API

| Méthode       | Route                                                | Rôle                                                               |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| GET           | `/state`                                             | Session en cours, préréglages, tâches, historique, temps par tâche |
| POST          | `/start` `{ config, name?, taskId?, subject? }`      | Lance une session (une seule à la fois)                            |
| POST          | `/pause` · `/resume` · `/stop` · `/skip` · `/extend` | Pilotage (`/extend { minutes }`)                                   |
| POST          | `/answer { done }` · `/dismiss`                      | « Tâche terminée ? » · « Plus tard »                               |
| POST · DELETE | `/presets` · `/presets/:id`                          | Préréglages                                                        |
| GET           | `/events` (SSE, ticket)                              | Session et changements de phase en direct                          |
