# Agenda (`agenda`)

La semaine d'un coup d'œil, rapide à remplir, reliée aux autres outils. Portable (PC et téléphone), « Prêt pour la synchro », « Prêt pour le calendrier ». Validé à l'usage par Thomas (v0.41.0) ; seules les nouveautés de la v0.41.0 et l'import en tableau (CSV, Excel) restent **Expérimental**.

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

Colonnes par jour, heures de la journée (réglage « Début / Fin de la journée », 7 h – 23 h par défaut), blocs colorés par catégorie (`--series-1…8` des thèmes, `shared/categories.ts`), aujourd'hui mis en avant ; rangée du haut pour les événements sur la journée et sur plusieurs jours ; bande « À caser » (tâches échues cette semaine, rangées par échéance, puis celles sans échéance, repliables) ; sous chaque jour une **barre de charge** découpée par catégorie (heures d'événements + durées estimées des tâches échues ce jour-là) et un état léger / chargé / saturé ; en tête « X h de libre · Y h à caser · + N tâches sans durée » ; chevauchements signalés ; blocs « titre d'abord » (v0.38.0 : un bloc de 45 min ou moins tient sur une ligne, le titre puis l'heure s'il reste de la place, « … » quand ça déborde ; un bloc plus haut montre l'heure puis le titre ; marges de 2 px / 4 px, police inchangée) ; **interrupteurs de catégorie** (v0.35.0, voir plus bas) ; vue mois légère. Calculs purs dans `shared/load.ts`.

**Charge** (catégories allumées seulement) : heures des événements et des tâches prévues dans la plage de la journée, par catégorie, plus les durées estimées des tâches échues ce jour-là (« Tâches » ; une tâche en retard pèse sur aujourd'hui, jamais sur un jour passé ni sur une semaine suivante). Léger sous 50 % de la plage, chargé sous 85 %, saturé au-delà. Les événements sur la journée (un camp, un examen) n'ont pas d'heures : ils ne pèsent pas. **Libre** : la plage moins les événements (chevauchements comptés une fois). **À caser** : les durées estimées des tâches qui pèsent sur un jour de la semaine (celles en retard dans la semaine en cours) ; les tâches sans échéance sont dans la bande, pas dans ce total.

## Agir sur place (v0.36.0)

- **Fiche complète d'une tâche** : un clic sur une tâche prévue (semaine, jour, mois) ou à caser ouvre la fiche **prêtée par la To-do** (`todo.taskEditor`, ADR 0046). Elle contient :
  - tous les champs (titre, tags, échéance, durée estimée, heure prévue, morceau), avec le formulaire et les vérifications de la To-do, sans copie ;
  - « Faite », « Retirer de l'agenda », « Supprimer » (confirmation puis « Annuler »), « Ouvrir dans la To-do ».

  Chaque changement s'affiche dans la semaine, avec « Annuler » (les valeurs d'avant réécrites).

- **Cocher** (v0.38.0) : plus de case sur les blocs ni sur les lignes de la vue jour. Clic sur le bloc → la fiche de la To-do, case **« Faite »** en haut (« À refaire » quand elle est faite) : une écriture, « Annuler » juste après. Une tâche faite reste barrée et atténuée ; le ⚠ « prévue après son échéance » disparaît quand elle est faite (« chevauche » reste). La route `PUT /tasks/:id/done` reste (service `todo`).
- **Créer dans un trou** :
  - PC : clic sur un créneau vide → saisie ancrée là, jour et heure au quart d'heure, 30 min ; glisser sur une plage vide → cette durée ;
  - téléphone, vue jour : les créneaux libres (30 min au moins) sont listés, toucher l'un d'eux ouvre la même saisie ;
  - deux choix : **« Tâche »** (tâche de la To-do prévue à ce moment, durée de la plage ; Entrée) ou **« Rendez-vous »** (événement de l'Agenda) ;
  - aperçu avant de créer, Échap annule, rien n'est créé avant le choix ; « Annuler » après.

  Routes `POST /tasks` et `DELETE /tasks/:id` (pour « Annuler » seulement) → service `todo`. Calculs purs : `slotSpan` (`shared/drag.ts`), `freeGaps` (`shared/load.ts`).

- **Panneau d'un événement** : tous les champs modifiables directement (plus d'étape « Modifier »), « Enregistrer » avec « Annuler ». Une occurrence de la semaine type garde ses actions « cette fois-ci ».

## Timer depuis l'Agenda (v0.36.0)

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

## Interrupteurs de catégorie (v0.35.0)

Les calques de v0.34 deviennent des **interrupteurs** : une catégorie **allumée** est affichée **et comptée** (charge, temps libre, chevauchements, « à caser » pour « Tâches ») ; **éteinte**, elle n'est ni affichée ni comptée (remplace la règle « la charge compte toujours tout »).

- **Par défaut éteintes** : Sport, Repas (les repas prêts), Timer — les choses de tous les jours. **Allumées** : les catégories de l'Agenda, Tâches, **Cuisine** (v0.38.0 : les séances de batch cooking des Courses, à caser dans la journée ; un appareil qui a déjà des choix enregistrés la reçoit allumée, ses autres choix ne changent pas), Musique. Liste de départ modifiable : réglage « Catégories éteintes par défaut » (`categoriesOff`, « Sport, Repas, Timer »), lu dans `RangeDto.categoriesOff`.
- Choix **propre à chaque appareil** (`localStorage`, `toolbox.agenda.categorySwitches`, jamais synchronisé) ; les calques masqués en v0.34 sont repris comme éteints.
- Le bilan de la semaine dit ce qui n'est pas compté (« hors Sport, Repas, Timer »).
- Règle pure : `isOn(catégorie, choix, éteintes par défaut)` (`shared/categories.ts`), comptage par `timedBlocks(data, shown)` et `taskLoads(data, shown)` (`frontend/common.ts`), testés (`tests/layers.test.ts`).

## Tâches prévues et glisser-déposer (v0.35.0)

Une tâche reste **une donnée de la To-do** : l'Agenda la lit par le calendrier (un événement de la To-do avec `itemId`, ADR 0045) et la modifie **par le service `todo`** (`planTask`), jamais par une copie. Tout changement d'un côté se voit de l'autre, sur le PC et le téléphone (champs synchronisés de la To-do).

- **PC, glisser-déposer** (calculs purs dans `shared/drag.ts`, testés) :
  - une tâche de « À caser » → la grille : prévue ce jour, à cette heure, magnétisme au quart d'heure, pour sa durée estimée (30 min sans durée, et la durée estimée prend cette valeur) ;
  - un bloc (tâche prévue ou événement de l'Agenda) → une autre heure ou un autre jour (sa durée gardée) ;
  - le **bas** d'un bloc → sa durée (15 min au moins ; pour une tâche, sa durée estimée) ;
  - une **occurrence de la semaine type** : cette fois-ci seulement (l'exception existante) ;
  - les éléments des autres modules (Sport, Repas, Cuisine, Timer, Musique) ne se déplacent pas : curseur et infobulle le disent, un clic les ouvre dans leur outil ;
  - les événements sur la journée ou sur plusieurs jours : pas dans cette version.

  Pendant le glisser : aperçu de l'heure de début et de fin, **Échap** annule. **Rien n'est écrit pendant le glisser : une seule écriture au dépôt**, puis « Annuler » (les valeurs d'avant réécrites).

- **Détail d'une tâche prévue** (clic, PC et téléphone) : jour, heure, durée, « Retirer de l'agenda » (retour dans « À caser »), « Ouvrir dans la To-do ». Cochée : barrée, toujours là. Prévue après son échéance (et pas faite) : signalée.
- **Téléphone** : pas de glisser ; heure et durée se changent par le détail (tâche et événement).
- Route : `PUT /tasks/:id/plan { plannedAt?, durationMin? }` (`plannedAt: null` = retirer de l'agenda) → service `todo`.

## Facultatif (v0.40.0)

Case **« Facultatif »** dans la fiche d'un événement de l'Agenda (rendez-vous, événement importé ; PC et téléphone), une écriture et « Annuler ». Un événement facultatif reste affiché à sa place (côte à côte avec ce qu'il chevauche), atténué et hachuré (jetons du thème), « facultatif » dans l'info-bulle et la fiche. Il ne compte pas :

- **conflits** : un chevauchement où au moins un des deux est facultatif ne donne ni ⚠ ni contour orange ; deux éléments qui comptent : signalés comme avant ;
- **charge et temps libre** : il n'est pas compté (comme une catégorie éteinte).

Par élément : une occurrence importée est un événement à part. Il appartient à Thomas, jamais au fichier : un réimport ne le lit pas, ne l'écrit pas et ne le compte pas comme « modifié par toi ». Pas pour les tâches ni pour les éléments des autres outils, ni pour les occurrences de la semaine type. Donnée : colonne `optional` (0 / 1) de `agenda__events` (migration 5, ajout seul), synchronisée ; `PATCH /events/:id { optional: true | false }` ; `AgendaEventDto.optional` présent seulement quand vrai.

## Rendez-vous ou tâche (v0.43.0, correctif prévu en v0.41.1)

Chemins de création, et ce que chacun crée :

| Chemin                                                            | Crée                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Créneau vide (clic, glissé, trou du téléphone)                    | **Rendez-vous** par défaut et avec Entrée ; « Tâche » seulement par son propre clic                                                                                               |
| Barre « Ajouter » › Rendez-vous                                   | un rendez-vous (ou une entrée de la semaine type) ; **jamais une tâche** : sans date et heure, ou « ~1h » sans heure → refusé, rien d'écrit (`/quick` avec `mode: 'appointment'`) |
| Barre « Ajouter » › Tâche                                         | une tâche (To-do)                                                                                                                                                                 |
| Barre de saisie de l'Agenda                                       | rendez-vous, semaine type, ou tâche « à caser » (son rôle, inchangé), aperçu avant                                                                                                |
| « Formulaire détaillé », fiche, « Dupliquer la semaine suivante » | un rendez-vous                                                                                                                                                                    |
| Semaine type                                                      | une entrée de la semaine type                                                                                                                                                     |
| Import                                                            | des rendez-vous                                                                                                                                                                   |

**Convertir** (fiche et clic droit) : « Convertir en tâche » (un rendez-vous → une tâche prévue à la même heure et pour la même durée ; sur la journée : une tâche pour ce jour) et « Convertir en rendez-vous » (une tâche prévue → un rendez-vous à son heure ; seulement une échéance → sur la journée ; ni l'un ni l'autre : refusé). Une action ; « Annuler » remet exactement l'état d'avant (l'élément converti revient de sa suppression logique, celui créé est supprimé). Le timer associé suit. Routes : `POST /events/:id/to-task`, `POST /tasks/:id/to-event`, `POST /tasks/:id/restore` (service `todo` : `restoreTask`, `timerPref`).

## Catégories : de vrais objets (v0.43.0, Expérimental, ADR 0049)

Une **catégorie** est ce à quoi un élément est rattaché (Cours, Scouts…) ; elle a un identifiant et des réglages qui agissent. Son **type par défaut** (l'ancienne « forme » de la v0.42) pré-remplit les nouveaux éléments ; le type lui-même est porté par l'élément (partie Deadline ci-dessous).

Réglages › Agenda › Catégories : toutes les catégories (celles de l'Agenda, « Deadline », celles des autres outils, les tiennes, et toutes celles trouvées dans tes événements, ta semaine type et tes correspondances d'import), avec leur pastille, leur type par défaut et leur nombre d'éléments.

- **Nouvelle catégorie** : un nom (unique, sans tenir compte des majuscules ni des accents) et une couleur, aussi depuis la fiche, la barre et un créneau vide (« Nouvelle catégorie… »).
- **Couleur** : 16 teintes de la palette (thèmes clairs et sombres, `tests/palette-contrast.test.ts`), une **couleur libre** (avertissement si le contraste est faible), « Revenir à la couleur d'origine ». Partout : blocs, vue jour, interrupteurs, aperçu, fiche.
- **Réglages qui agissent** : _Comptée_ (charge), _Chevauchements signalés_ (éteint : ses éléments ne sont jamais signalés en conflit, ils restent comptés), _Allumée par défaut_ (valeur de départ de son interrupteur), **durée et lieu par défaut** (pré-remplis quand on la choisit dans la fiche ou dans un créneau vide), **type par défaut** (tes catégories), ordre.
- **Tes catégories seulement** : renommer (ne touche **que** la ligne de la catégorie : les éléments la désignent par son identifiant ; « Annuler »), supprimer (ses éléments vont dans la catégorie choisie, **jamais supprimés** ; sauvegarde ; « Annuler »).
- Les catégories fixes et celles des autres outils : couleur et réglages seulement (l'interface le dit).
- **Tâches** : la fiche de tâche (prêtée par la To-do) a « Catégorie dans l'Agenda ». Le lien est dans une table de l'Agenda (`agenda__task_categories`) : la To-do ne change pas.

Données (migration 7, ajouts seuls, sauvegarde avant comme toute migration) :

- `agenda__categories` gagne `conflicts`, `default_duration`, `default_location`, `builtin`, `found` (nom seulement trouvé dans ses données, jamais créé : pas d'interrupteur hors de sa période, comme en v0.42) ; la colonne `shape` reste et sert de type par défaut.
- `agenda__events` gagne `category_id` et `kind` (`rendez-vous` par défaut, `deadline` pour les événements d'une catégorie de forme Deadline) ; `agenda__weekly` gagne `category_id` ; `agenda__sources` gagne `mapping_ids` et `default_category_id` (un réimport suit un renommage).
- Une ligne par catégorie connue. Les lignes déjà écrites en v0.42 gardent leur identifiant et leurs valeurs ; les autres reçoivent un **identifiant déterministe** (UUID v5 du nom replié, `shared/category-id.ts`) : le PC et le téléphone, migrés chacun de leur côté, écrivent les mêmes lignes ; la synchro ne voit ni doublon ni conflit (`tests/sync/agenda-categories-upgrade.test.ts`). Ces lignes semées ne passent pas par le journal (identiques des deux côtés).
- Aucune colonne existante n'est réécrite ; la colonne texte `category` reste écrite à chaque changement (lisible par une version d'avant). Elle peut garder un ancien nom après un renommage : on lit d'abord `category_id`, puis le nom en secours (jamais un élément sans catégorie à l'écran). Un nom arrivé plus tard (synchro) s'affiche avec l'identifiant tiré de son nom ; sa ligne est écrite avec cet identifiant au premier changement.
- Limite : une catégorie créée en v0.42 sur un seul appareil, jamais synchronisée avant la montée, peut rencontrer la ligne semée de l'autre : collision sur `key`, le PC gagne (Conflits). Une catégorie créée pendant un import n'est pas retirée par « Annuler l'import ».

Routes : `GET/POST /categories`, `PATCH /categories/:id` (couleur, comptée, allumée, chevauchements, type / durée / lieu par défaut), `PUT /categories/order`, `POST /categories/:id/rename`, `DELETE /categories/:id?moveTo=<id>`, `POST /categories/undo`, `PUT /tasks/:id/category { categoryId | null }`. `:id` accepte aussi le nom. `RangeDto.categoryInfo` donne la liste ; événements, semaine type et tâches prévues portent `categoryId`.

## Type Deadline (v0.42.0 ; porté par l'élément depuis v0.43.0, Expérimental, ADR 0049)

Le **type** d'un élément (Rendez-vous ou Deadline) est à lui : colonne `kind` d'`agenda__events` (`rendez-vous` par défaut). La **catégorie** ne fait que proposer un type par défaut (« Deadline » pour la catégorie fixe « Deadline » et pour celles de Thomas réglées ainsi). Une deadline peut donc être dans **n'importe quelle catégorie** : la forme d'alerte vient du type, la couleur de la catégorie. Une deadline est un **moment** : une date et une heure facultative, **sans fin** (le serveur écrit fin = début ; repasser en Rendez-vous donne un bloc d'une heure).

- **Où se choisit le type** : la fiche (« Type », pré-rempli quand on choisit une catégorie, encore modifiable) ; le clic droit (« En faire une deadline / un rendez-vous », « Annuler » remet type et heures) ; la barre de l'Agenda et la destination « Rendez-vous » de la barre « Ajouter » : **« deadline rendu rapport jeudi 23h59 »** (aussi « échéance : … ») — dans « Deadline », ou dans la catégorie écrite (« #cours ») ou choisie. Sans date, avec « ~1h », sur plusieurs jours ou en semaine type : refusé, **rien n'est écrit**, message clair. **Jamais une tâche de la To-do.**
- **Changer de catégorie ne change pas le type** (en v0.42, la catégorie le décidait). Créer sans type (`POST /events`, créneau vide, import) : le type par défaut de la catégorie. Un import qui change la catégorie d'un événement lui donne le type par défaut de la nouvelle ; sinon un réimport ne touche jamais au type. Un événement importé garde la fin de son fichier (un réimport la compare) ; une deadline se dessine à son début.
- Une occurrence de la semaine type n'a pas de type à elle : comme en v0.42, une occurrence dans une catégorie dont le type par défaut est Deadline ne compte pas dans la charge.
- Semaine (PC) : avec une heure, un trait épais (couleur de sa catégorie) à cette heure en travers du jour, étiqueté (icône, titre, heure), au-dessus des blocs sans les cacher (le trait laisse passer les clics ; l'étiquette prend au plus 65 % de la colonne) ; sans heure, une bande dans « Journée ». Téléphone : la même logique dans la liste du jour.
- Jamais comptée dans la charge ni le temps libre ; aucun chevauchement. En retard et pas faite : reste en alerte (« en retard de … »). **Faite** / **À refaire** (case dans la fiche ou clic droit, « Annuler ») : atténuée et barrée (colonne `done_at`, migration 6).
- Ligne **« Deadlines »** en haut de la semaine (et du jour) : celles pas faites de la semaine affichée et des 7 jours suivants, et celles en retard (60 jours au plus), triées, avec le temps restant ; clic = la fiche ; se masque comme un interrupteur (local à l'appareil). `RangeDto.deadlines`, `shared/deadline.ts` (`untilText`, pur).
- Aperçu et fiche : type, catégorie, temps restant, faite ou non. Aucune notification (rappels proposés dans la feuille de route, désactivés par défaut).
- Montée v0.42 → v0.43 (migration 7) : les événements d'une catégorie de forme Deadline reçoivent `kind = deadline`, les autres `rendez-vous` (le même remplissage sur le PC et le téléphone).

## Clic droit (v0.42.0, Expérimental, ADR 0048)

Menu commun du SDK (`useContextMenu`, MODULES.md §7.7) sur les blocs de la semaine (PC), la liste du jour (téléphone : appui long), « À caser », les deadlines (trait, bande, ligne « Deadlines »). `frontend/Menus.tsx`, `agendaMenuItems` (pur, testé) : seulement les actions déjà possibles dans la fiche.

- Événement : Ouvrir la fiche, Facultatif / Obligatoire, Lancer le timer…, Changer de catégorie (sous-menu, « Nouvelle catégorie… »), Couleur de cette catégorie…, Supprimer (question, puis « Annuler »).
- Deadline : Ouvrir la fiche, Faite / À refaire, Changer de catégorie, Couleur…, Supprimer.
- Occurrence de la semaine type : Ouvrir la fiche, Lancer le timer…, Couleur… (le reste se fait dans la fiche ou la semaine type).
- Tâche prévue / à caser : Ouvrir la fiche, Faite / À refaire, Lancer le timer…, Couleur de « Tâches »… (prévue).
- Élément d'un autre outil : « Ouvrir dans son outil » seulement.
- « Lancer le timer… » ouvre la fiche, où le Timer prête son bouton (l'Agenda n'appelle jamais le Timer lui-même) ; désactivé avec sa raison sans le Timer. Chaque écriture a son « Annuler ».

## Importer un calendrier (v0.37.0, ADR 0047 ; tableau CSV / Excel encore Expérimental)

Agenda › **Importer** (sur le PC ; le lien n'est pas montré sur le téléphone, qui reçoit les événements par la synchro). Le fichier est lu sur le PC, rien ne part en ligne.

- **Formats** : `.ics` (iCalendar) ; `.csv` (séparateur `;`, `,` ou tabulation, UTF-8 ou Windows-1252) ; `.xlsx` (première feuille).
- **Étape « choix »** : nouvelle source, ou mise à jour d'une source (proposée quand le nom du calendrier ou des UID correspondent) ; chaque valeur de catégorie du fichier → une catégorie de l'Agenda, avec le nombre d'événements (le reste → la catégorie par défaut) ; période « à partir d'aujourd'hui » (défaut) ou « tout » ; titre « Thermo » ou « TH2C · Thermo » ; pour un tableau, quelle colonne donne quoi.
- **Aperçu, rien n'est écrit** : à ajouter / identiques / modifiés (avec les différences) / disparus / ignorés (passés) / erreurs (ligne, raison). Les modifiés sont cochés, sauf ceux que tu as changés depuis le dernier import (« modifié par toi », décochés) ; les disparus sont décochés (cochés : suppression logique, restaurable) ; un événement que tu avais supprimé revient décoché.
- **Importer** : sauvegarde automatique, une transaction, résumé, « Annuler l'import » (20 s à l'écran, possible 10 minutes par la route). Réimporter le même fichier : tout est « identique », rien n'est écrit (pas même la source).
- **ICS lu** : lignes repliées, échappements `\n \, \;`, TZID (données du système, sinon le VTIMEZONE du fichier), UTC (`Z`), heures flottantes, journées entières (`VALUE=DATE`, fin exclusive → dernier jour inclus), DTEND ou DURATION (sans les deux : 1 h, ou 1 jour), `RRULE` DAILY / WEEKLY (COUNT, UNTIL, BYDAY multiples, INTERVAL, WKST), RDATE, EXDATE, RECURRENCE-ID, STATUS:CANCELLED. Répétitions **dépliées** en événements (clé « UID#AAAAMMJJ ») ; une règle sans fin s'arrête un an après aujourd'hui ; 2 000 occurrences au plus par événement. Tout le reste (mensuel, annuel, BYSETPOS…) : listé en erreur, rien n'est importé pour lui.
- **Titre et note** (v0.38.0, forme réelle de l'export d'école) : un **cours** a un code en SUMMARY (« ®-RE4L-L2-4MEO-4MIN ») et son nom dans la ligne « Act: » de la description → titre « Computer Network Lab », code « RE4L-L2-4MEO-4MIN » (« ® » de tête retiré), montré seulement avec le style « code · titre ». Sans ligne « Act: » : « TH2C:Thermo » → « Thermo » (code « TH2C »), sinon le SUMMARY tel quel. Un **examen** : « [ECRIT] » / « [ORAL] » trouvé dans la description (ou le titre) → « Thermo · Écrit » / « · Oral ». La note reprend les autres lignes (« Groupe : … · Enseignants : … · Remarque : … ») : la ligne « Act: » qui sert de titre, la ligne qui ne fait que répéter le SUMMARY et son type, et une « clé: » sans valeur (« Ens: ») n'y sont pas. Le lieu tel quel (« 2F51;2E51;2E44 »). Le **texte d'origine** (UID, SUMMARY, DESCRIPTION, LOCATION, CATEGORIES ; ou les colonnes du tableau) est gardé dans l'événement et montré dans son détail. Les clés d'origine ne changent pas : un réimport d'un fichier importé en v0.37.0 propose les nouveaux titres en « modifiés », sans doublon (« modifié par toi » respecté).

### Tableau CSV / Excel

Modèle téléchargeable (Agenda › Importer › modèle CSV ou Excel), colonnes :

| Colonne            | Contenu                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `titre`            | obligatoire                                                                                             |
| `date`             | obligatoire : `15/01/2027`, `5/1/27`, `2027-01-15`, avec une heure possible, ou une date Excel          |
| `début`            | `8h30`, `8h`, `08:30`, `8:30:00`, fraction Excel ; vide = toute la journée                              |
| `fin` ou `durée`   | fin : une heure (avant le début = le lendemain) ou une date ; durée : `90`, `1h30`, `1:30` ; rien = 1 h |
| `toute la journée` | `oui` / `non` (aussi `x`, `1`, `vrai`)                                                                  |
| `lieu`, `note`     | facultatifs                                                                                             |
| `catégorie`        | valeur à faire correspondre à une catégorie de l'Agenda (comme les CATEGORIES d'un ICS)                 |
| `identifiant`      | facultatif : la clé des mises à jour                                                                    |

Un autre fichier : l'écran des colonnes (deviné depuis l'en-tête, gardé pour la source). **Sans colonne identifiant**, la clé est titre + début : un cours **déplacé** apparaît comme **disparu + ajouté** (l'ancien n'est supprimé que si tu coches).

### Sources (Réglages › Agenda)

Nom, format, catégories, nombre d'événements, dernier import ; renommer ; changer les correspondances (appliqué aux événements de la source, sauf à ceux dont tu as changé la catégorie) ; réimporter ; supprimer (confirmation, sauvegarde, suppression logique de la source et de ses événements, « Annuler » les restaure).

## Données (« Prêt pour la synchro », MODULES.md §6 bis)

| Élément      | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables       | `agenda__events` (titre, `start_at`, `end_at` : dates pour la journée, dernier jour inclus ; date-heures sinon ; `all_day`, lieu, note, catégorie) · `agenda__weekly` (titre, jour 0 = lundi, heure, durée, catégorie, lieu, `valid_from`, `valid_until`) · `agenda__exceptions` (occurrence annulée ou déplacée : `weekly_id`, `occurrence_date`, `kind`, nouveau début et durée) · `agenda__sources` (v0.37.0 : nom, format, `calendar_name`, `mapping` JSON, `default_category`, `title_style`, `columns` JSON, `last_import_at`) · `agenda__changes`. Événements importés (v0.37.0) : `source_id`, `origin_key`, `origin` ; « facultatif » (v0.40.0) : `optional` (JSON : texte d'origine, valeur de catégorie du fichier, valeurs du dernier import) |
| Synchro      | `sync: {}` et migration 2 `syncJournalSql` : tout voyage entre le PC et le téléphone. Une seule exception vivante par occurrence (les précédentes passent en suppression logique ; si deux appareils en écrivent une, la plus récente compte)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Suppressions | logiques, « Annuler » (`/restore`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Fichiers     | aucun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Facultatif   | `todo` (« À caser », la barre ajoute des tâches)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Les autres modules sont **lus** par `ctx.calendar.query` (jamais écrits) ; ceux qui donnent des éléments à caser (la To-do) ne sont pas affichés deux fois.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

Ses événements et les occurrences de la semaine type, catégorie comprise ; `endDate` pour ceux sur plusieurs jours ; le lieu en `status`. Lecture seule.

## API

`GET /range?from&to` (62 jours au plus ; `tasks` = tâches prévues, v0.35.0) · `POST /quick { text }` · `PUT /tasks/:id/plan` · `PUT /tasks/:id/done` · `POST /tasks` · `DELETE /tasks/:id` · `POST /events` · `PATCH /events/:id` · `DELETE /events/:id` · `POST /events/:id/restore` · `POST /weekly` · `PATCH /weekly/:id` · `DELETE /weekly/:id` · `POST /weekly/:id/restore` · `PUT /weekly/:id/occurrences/:date { action: cancel | move | reset, start, durationMin }` · `GET /today`. Import (v0.37.0) : `POST /import/analyze` · `POST /import/preview` (rien n'est écrit) · `POST /import/apply { …, accept, remove }` · `POST /import/undo { importId }` · `POST /import/template { format }` · `GET /sources` · `PATCH /sources/:id { name?, mapping?, defaultCategory? }` · `DELETE /sources/:id` · `POST /sources/:id/restore`.

## Pas dans cette version

Rappels et notifications (consultation seulement). Abonnement à une URL ICS (prévu plus tard). Import depuis le téléphone.
