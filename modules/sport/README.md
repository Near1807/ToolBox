# Sport (`sport`) — Expérimental

Catégorie **Vie perso**. Un calendrier de sport simple : une **semaine type**, des séances validées, un bilan.

## Ce qu'il fait

- **Semaine type** (onglet « Semaine type ») : par jour de la semaine, des séances avec un **nom** (« Dos + abdos », « Push »…), une heure de début et une durée. Elle remplit les semaines à venir (la semaine en cours comprise, la première fois qu'elle s'affiche). Une modification vaut **à partir de demain** : elle ne touche ni le passé, ni aujourd'hui, ni les séances validées, annulées ou changées à la main (`shared/plan.ts : reapplyTemplate`). Les semaines passées ne sont jamais remplies après coup.
- **Une séance** (clic) : « Fait » / « Pas fait », humeur parmi 5 emojis, commentaire libre ; heure et durée pour cette séance seulement ; déplacement vers un autre jour **de la même semaine** (glisser-déposer ou liste) ; « Annuler la séance » / « Rétablir ». Changer l'heure, la durée ou le jour la marque « changée à la main » : la semaine type n'y touche plus.
- **Exercices** :
  - **bibliothèque** (onglet « Exercices ») : nom, note facultative ; autocomplétion en tapant ; un nom déjà présent (accents et majuscules ignorés) est refusé ; « Fusionner… » remplace un doublon par l'autre partout (semaine type et séances, passées comprises) ; « Supprimer » seulement pour un exercice qui ne sert nulle part (avec « Annuler ») ;
  - **liste ordonnée par séance de la semaine type** (bouton « Exercices (n) ») : exercice, séries × répétitions (texte libre : « 8 », « 8-10 », « 30 s »), charge, repos (s), note, tous facultatifs sauf le nom ; ↑ ↓ pour l'ordre. Un nom inconnu est ajouté à la bibliothèque à l'enregistrement ;
  - chaque séance **reçoit une copie** de la liste quand elle est planifiée ; « Modifier les exercices de cette séance » la change pour elle seule (la semaine type ne bouge pas, et la séance devient « changée à la main ») ;
  - **affichage rapide** : clic sur une séance de la semaine (en tête du détail), du mois (sous le calendrier) ou de la carte d'accueil.
  - Pas de suivi « réalisé » séparé : le commentaire de validation sert à ça.
- **« + Séance »** sur chaque jour : séance ponctuelle ; elle seule peut être **supprimée** (confirmation, puis « Annuler » ; suppression logique). Une séance de la semaine type s'annule.
- **Vues** : semaine (par défaut, ‹ › pour naviguer) et mois ; séances passées non validées en orange (« à valider »).
- **Bilan** : faites / prévues sur la semaine et le mois (annulées non comptées), séries de semaines complètes, humeur moyenne, nombre à valider.
- **Export** du mois affiché en CSV ou Markdown (« Enregistrer sous »), avec le **commentaire** et les **exercices** de chaque séance. CSV séparé par `;`, champs entre guillemets quand il le faut (un commentaire sur plusieurs lignes reste entier).
- **Carte d'accueil** : séance(s) du jour.

## Assistant (MODULES.md §5.15)

| Action            | Risque | Exemples                                           |
| ----------------- | ------ | -------------------------------------------------- |
| `today-session`   | read   | « c'est quoi ma séance aujourd'hui »               |
| `today-exercises` | read   | « c'est quoi les exos de ma séance d'aujourd'hui » |
| `week-summary`    | read   | « mon bilan sport de la semaine »                  |
| `session-done`    | change | « séance faite », « séance pas faite »             |
| `session-mood`    | change | « humeur 4 »                                       |
| `session-comment` | change | « commentaire : bonne séance »                     |
| `move-session`    | change | « déplace ma séance de mardi à jeudi »             |

Les actions qui modifient sont derrière **« L'assistant peut valider et modifier les séances »**, désactivé par défaut ; chacune s'annule (« Annuler »). Elles visent la séance du jour (la première pas encore validée) ; le déplacement vise la semaine en cours.

## Données (« Prêt pour la synchro », MODULES.md §6 bis)

| Table              | Contenu                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sport__templates` | semaine type : jour (1 = lundi), nom, début, durée, exercices (JSON)                                                                                                                                         |
| `sport__exercises` | bibliothèque d'exercices : nom, note                                                                                                                                                                         |
| `sport__sessions`  | séances : jour, semaine (lundi), nom, début, durée, état (`planned` / `done` / `missed` / `cancelled`), humeur, commentaire, ligne de la semaine type, changée à la main, exercices (JSON : sa propre copie) |
| `sport__weeks`     | semaines déjà remplies depuis la semaine type                                                                                                                                                                |
| `sport__changes`   | journal des modifications                                                                                                                                                                                    |

UUID, `created_at` / `updated_at`, suppression logique (`deleted_at`) partout, via `SyncStore`. Migrations 1 et 2 (v0.23 : bibliothèque, colonne `exercises` sur la semaine type et les séances). Les listes d'exercices sont une colonne JSON de la ligne (`[{ exerciseId, sets, reps, load, restSec, note }]`) : elles se synchronisent avec leur séance.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

`ctx.calendar` : chaque séance non annulée = un événement (nom, début, durée, lien `/m/sport?week=<lundi>`). Pour les semaines à venir pas encore affichées, la source renvoie ce que donnera la semaine type, **sans rien écrire**.

## API

| Méthode                     | Route                                                          | Rôle                                                                           |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GET                         | `/week?start=` · `/month?month=` · `/home`                     | Semaine (jours, séances, bilan, semaine type) · mois · accueil                 |
| PUT                         | `/template` `{ items }`                                        | Semaine type (appliquée à partir de demain)                                    |
| POST · PATCH                | `/sessions` · `/sessions/:id`                                  | Ajouter · valider, humeur, commentaire, heure, durée, jour, exercices, annuler |
| DELETE · POST               | `/sessions/:id` · `/sessions/:id/restore`                      | Supprimer une séance ajoutée à la main · la rétablir                           |
| GET · POST · PATCH · DELETE | `/exercises` · `/exercises/:id`                                | Bibliothèque : lire, ajouter, renommer / note, supprimer (inutilisé)           |
| POST                        | `/exercises/merge` `{ from, into }` · `/exercises/:id/restore` | Fusionner deux exercices · rétablir                                            |
| POST                        | `/export` `{ format, from, to }`                               | CSV ou Markdown via « Enregistrer sous »                                       |

## Tests

`tests/plan.test.ts` (dates, semaine type appliquée et modifiée, déplacement dans la semaine, bilan, série), `tests/commands.test.ts`, `tests/module.test.ts` (exercices copiés, liste propre à une séance, doublons, fusion, suppression d'une séance ajoutée et rétablissement, export avec commentaire et exercices, socle réel : remplissage, jamais le passé, validation, déplacement, ajout, changement de semaine type après aujourd'hui, source du calendrier sans écriture, droit de l'assistant).

## À solidifier (prototype)

- Pas de tags.
- Une séance de la semaine type annulée reste visible barrée (pas de suppression).
- Les listes d'exercices sont en JSON dans la ligne de séance : une modification simultanée sur deux appareils garde la dernière liste entière (synchro future).
