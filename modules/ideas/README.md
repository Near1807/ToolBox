# Boîte à idées (`ideas`)

Section **Outils**. Noter une idée en une seconde et la retrouver quand on en a besoin. Ce n'est pas une to-do : une idée n'a ni échéance ni case « Fait » ; elle peut **devenir** une tâche sur un clic (ADR 0038).

## Ce qu'il fait

- **Une idée** : titre court (obligatoire), texte libre long facultatif, tags, dates de création et de modification, morceau lié facultatif (Bibliothèque en service facultatif).
- **Texte** : mise en forme simple, jamais de HTML : `**gras**`, `*italique*`, lignes commençant par « - » = liste, liens `https://…` ou `[texte](https://…)` (ouverts dans le navigateur).
- **Capture rapide** en haut de la page : le titre, Entrée (« Noter ») ; « Texte, tags… » pour le reste.
- **Tags** : ajout rapide (Entrée ou virgule) avec les tags existants proposés ; filtre multi-tags (une idée doit avoir **tous** les tags choisis) ; « Tags… » : nombre d'idées par tag, couleur (couleurs du thème `--series-1` à `--series-8`), renommer, et fusionner (renommer en un tag qui existe, après confirmation). Archives comprises.
- **Recherche plein texte** : titre, texte et tags ; accents et majuscules ignorés ; tous les mots doivent être présents. **Tri** : récentes, anciennes, modifiées récemment (archiver ne compte pas comme une modification).
- **« Une idée au hasard »** : parmi les idées non archivées qui ont les tags du filtre actif.
- **Archiver / désarchiver** (vue « Archives ») ; **supprimer** après confirmation, avec « Annuler » (gardé en mémoire une heure).
- **« Transformer en tâche »** (si la To-do est là) : une tâche avec le même titre, les tags et le morceau ; l'idée reste, marquée « devenue une tâche ». Une seule fois par idée. Sans la To-do : le bouton n'apparaît pas.
- **Exporter en Markdown…** (« Enregistrer sous », `ctx.files.saveAs`) : toutes les idées, archives comprises.
- **Carte d'accueil** (réglage « Carte d'accueil », activé) : nombre d'idées et les trois dernières.
- **Page du morceau** (Bibliothèque) : les idées liées au morceau.

## Assistant (MODULES.md §5.15)

| Action        | Risque | Droit                                                            | Exemples                                                                                     |
| ------------- | ------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `add-idea`    | change | « L'assistant peut ajouter des idées », **désactivé** par défaut | « idée : un break avec des cordes #arrangement », « note une idée … », « j'ai une idée : … » |
| `list-ideas`  | read   | —                                                                | « montre mes idées #musique », « quelles sont mes idées »                                    |
| `random-idea` | read   | —                                                                | « une idée au hasard », « pioche une idée #clip »                                            |

Voix et barre écrite (même chemin). Une idée dite longue garde le texte entier ; son titre en est le début. « Annuler » retire une idée ajoutée par l'assistant. La To-do laisse « note une idée … » à la Boîte à idées.

## Données

| Table          | Contenu                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `ideas__ideas` | titre, texte, tags (JSON), `subject` (`music-library:track:<id>`), archivée le, tâche créée (id, titre), dates |
| `ideas__tags`  | couleur d'un tag (0 = aucune, 1–8)                                                                             |

Dans `hub.db`, donc dans les sauvegardes. Migration 1 (création des tables). Aucun fichier généré.

## Dépendances

Aucune obligatoire. `optionalServices` : `musicLibrary` (morceau lié, page du morceau), `todo` (« Transformer en tâche », par `createTask`, seulement sur un clic).

## API

| Méthode               | Route                                                         | Rôle                                                              |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET                   | `/ideas?q=&tags=a,b&sort=recent\|old\|modified&archived=0\|1` | Idées filtrées, tags (nombre, couleur), compteurs                 |
| POST · PATCH · DELETE | `/ideas` · `/ideas/:id`                                       | Créer · modifier (`archived` compris) · supprimer                 |
| POST                  | `/ideas/:id/restore` · `/ideas/:id/to-task`                   | Annuler une suppression · transformer en tâche                    |
| GET                   | `/random?tags=` · `/home`                                     | Une idée au hasard · carte d'accueil                              |
| PUT                   | `/tags/:name` `{ name?, color? }`                             | Renommer (fusion si le nom existe) · couleur                      |
| POST                  | `/export` `{ archives? }`                                     | Markdown via « Enregistrer sous » (`{ path }` ou `{ cancelled }`) |

## Tests

`tests/shared.test.ts` (recherche sans accents, filtre multi-tags, mise en forme sans HTML, idée longue, Markdown), `tests/commands.test.ts` (phrases de l'assistant), `tests/module.test.ts` (socle réel : CRUD, archives, Annuler, recherche, tri, hasard filtré, couleur, renommage, fusion, transformation avec et sans To-do, export, droit de l'assistant).
