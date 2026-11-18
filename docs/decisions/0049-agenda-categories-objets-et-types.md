# 0049 — Agenda : catégories objets et types portés par l'élément

- Statut : acceptée (v0.43.0, fonction marquée « Expérimental »)
- Date : 18/11/2026

## Contexte

En v0.42, une catégorie n'était qu'un **nom** écrit sur chaque élément ; la table `agenda__categories` ne gardait que les changements de Thomas (couleur, forme…). Deux défauts : renommer obligeait à réécrire tous les éléments (une transaction lourde, une source de conflits de synchro), et la **forme** « Deadline » d'une catégorie décidait du comportement de ses éléments — impossible d'avoir une deadline dans « Cours ». Thomas a demandé deux notions séparées : le **type** (nature et comportement, défini dans le code : Rendez-vous, Deadline, Tâche, éléments des autres outils) et la **catégorie** (à quoi l'élément est rattaché, créée librement, avec des réglages qui agissent). Chaque élément a un type et une catégorie, indépendants.

## Décision

1. **La catégorie est un objet** : une ligne d'`agenda__categories` par catégorie connue, avec un identifiant ; événements et semaine type portent `category_id` ; le nom texte (`category`) reste écrit, lisible par une version d'avant, et sert de secours (jamais un élément sans catégorie à l'écran). Réglages qui agissent : couleur, comptée, allumée par défaut, chevauchements signalés, **type par défaut** (l'ancienne « forme »), durée et lieu par défaut, ordre. Renommer ne touche **que** la ligne de la catégorie.
2. **Identifiants déterministes** : toute ligne semée par la migration 7 reçoit l'UUID v5 du nom replié (sans accents, minuscules, espaces réduits ; espace de noms propre à l'Agenda, `shared/category-id.ts`, SHA-1 en JavaScript pur, portable). Le PC et le téléphone, migrés **chacun de son côté**, écrivent les mêmes lignes : la synchro ne voit ni doublon ni conflit. Ces lignes semées ne passent pas par le journal. Les lignes déjà écrites en v0.42 gardent leur identifiant et leurs valeurs. Un nom arrivé plus tard (synchro) est montré avec l'identifiant tiré de son nom, et sa ligne est écrite avec cet identifiant au premier changement.
3. **Le type est porté par l'élément** : colonne `kind` (`rendez-vous` par défaut, `deadline`). Créer sans type : le type par défaut de la catégorie ; changer de catégorie ne change pas le type ; la fiche pré-remplit le type au choix d'une catégorie. La forme d'alerte vient du type, la couleur de la catégorie. Remplissage de la migration : `deadline` pour les événements d'une catégorie de forme Deadline, `rendez-vous` sinon (déterministe, identique sur les deux appareils).
4. **Tâches** : leur catégorie d'Agenda est dans une table de l'Agenda (`agenda__task_categories`) ; la To-do ne change pas.
5. **Créée ou trouvée** : une catégorie seulement trouvée dans les données (semée par la migration, ou « utilisée » en v0.42) porte `found = 1` ; comme en v0.42, seules celles créées par Thomas ont un interrupteur hors de leur période. Toutes deux se renomment et se suppriment (seules les intégrées et celles des autres outils sont verrouillées).
6. **Invariant** : la migration 7 n'ajoute que des colonnes, une table et des lignes ; aucune colonne existante n'est réécrite (md5 vérifié dans `tests/sync/agenda-categories-upgrade.test.ts`) ; sans action de Thomas, la semaine et la charge restent identiques au pixel.

## Conséquences

- Les correspondances d'import visent l'identifiant (`mapping_ids`, `default_category_id`) : un réimport suit un renommage.
- Limite connue : une catégorie créée en v0.42 sur un seul appareil, jamais synchronisée avant la montée, peut rencontrer la ligne semée de l'autre (collision sur `key`, le PC gagne, visible dans Conflits).
- Les autres types (événement de plusieurs jours en tant que type, rappel…) viendront un par un ; la To-do reste maîtresse de ses tâches.
- Écarté : réécrire la colonne `category` des éléments en identifiants (casse la lecture par une version d'avant, réécrit des données existantes) ; identifiants aléatoires à la migration (doublons à la première synchro).
