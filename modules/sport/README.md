# Sport (`sport`) — Expérimental

Catégorie **Vie perso**. Un calendrier de sport simple : une **semaine type**, des séances validées, un bilan.

## Ce qu'il fait

- **Semaine type** (onglet « Semaine type ») : par jour de la semaine, des séances avec un **nom** (« Dos + abdos », « Push »…), une heure de début et une durée. Elle remplit les semaines à venir (la semaine en cours comprise, la première fois qu'elle s'affiche). Une modification vaut **à partir de demain** : elle ne touche ni le passé, ni aujourd'hui, ni les séances validées, annulées ou changées à la main (`shared/plan.ts : reapplyTemplate`). Les semaines passées ne sont jamais remplies après coup.
- **Une séance** (clic) : « Fait » / « Pas fait », humeur parmi 5 emojis, commentaire libre ; heure et durée pour cette séance seulement ; déplacement vers un autre jour **de la même semaine** (glisser-déposer ou liste) ; « Annuler la séance » / « Rétablir ». Changer l'heure, la durée ou le jour la marque « changée à la main » : la semaine type n'y touche plus.
- **« + Séance »** sur chaque jour : séance ponctuelle.
- **Vues** : semaine (par défaut, ‹ › pour naviguer) et mois ; séances passées non validées en orange (« à valider »).
- **Bilan** : faites / prévues sur la semaine et le mois (annulées non comptées), séries de semaines complètes, humeur moyenne, nombre à valider.
- **Export** du mois affiché en CSV ou Markdown (« Enregistrer sous »).
- **Carte d'accueil** : séance(s) du jour.

## Assistant (MODULES.md §5.15)

| Action            | Risque | Exemples                               |
| ----------------- | ------ | -------------------------------------- |
| `today-session`   | read   | « c'est quoi ma séance aujourd'hui »   |
| `week-summary`    | read   | « mon bilan sport de la semaine »      |
| `session-done`    | change | « séance faite », « séance pas faite » |
| `session-mood`    | change | « humeur 4 »                           |
| `session-comment` | change | « commentaire : bonne séance »         |
| `move-session`    | change | « déplace ma séance de mardi à jeudi » |

Les actions qui modifient sont derrière **« L'assistant peut valider et modifier les séances »**, désactivé par défaut ; chacune s'annule (« Annuler »). Elles visent la séance du jour (la première pas encore validée) ; le déplacement vise la semaine en cours.

## Données (« Prêt pour la synchro », MODULES.md §6 bis)

| Table              | Contenu                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sport__templates` | semaine type : jour (1 = lundi), nom, début, durée                                                                                                                       |
| `sport__sessions`  | séances : jour, semaine (lundi), nom, début, durée, état (`planned` / `done` / `missed` / `cancelled`), humeur, commentaire, ligne de la semaine type, changée à la main |
| `sport__weeks`     | semaines déjà remplies depuis la semaine type                                                                                                                            |
| `sport__changes`   | journal des modifications                                                                                                                                                |

UUID, `created_at` / `updated_at`, suppression logique (`deleted_at`) partout, via `SyncStore`. Migration 1.

## Calendrier (« Prêt pour le calendrier », MODULES.md §5.17)

`ctx.calendar` : chaque séance non annulée = un événement (nom, début, durée, lien `/m/sport?week=<lundi>`). Pour les semaines à venir pas encore affichées, la source renvoie ce que donnera la semaine type, **sans rien écrire**.

## API

| Méthode      | Route                                      | Rôle                                                                |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------- |
| GET          | `/week?start=` · `/month?month=` · `/home` | Semaine (jours, séances, bilan, semaine type) · mois · accueil      |
| PUT          | `/template` `{ items }`                    | Semaine type (appliquée à partir de demain)                         |
| POST · PATCH | `/sessions` · `/sessions/:id`              | Ajouter · valider, humeur, commentaire, heure, durée, jour, annuler |
| POST         | `/export` `{ format, from, to }`           | CSV ou Markdown via « Enregistrer sous »                            |

## Tests

`tests/plan.test.ts` (dates, semaine type appliquée et modifiée, déplacement dans la semaine, bilan, série), `tests/commands.test.ts`, `tests/module.test.ts` (socle réel : remplissage, jamais le passé, validation, déplacement, ajout, changement de semaine type après aujourd'hui, source du calendrier sans écriture, droit de l'assistant).

## À solidifier (prototype)

- Pas d'exercices ni de tags (prévu plus tard).
- Une séance annulée reste visible barrée (pas de suppression) ; une séance ajoutée à la main ne se supprime pas encore.
