# Coffre (`coffre`, Expérimental)

Un seul endroit pour **garder, ranger, retrouver et ouvrir** les fichiers qui comptent. Cahier des charges complet : [`docs/coffre/CAHIER-DES-CHARGES.md`](../../docs/coffre/CAHIER-DES-CHARGES.md). ADR 0051 (socle), 0052 (modèle).

PC seulement (`PC_ONLY_MODULES`) ; dépendance facultative : le service `agenda` (cours importés).

## Sur le disque

`userData/coffre/` (`ctx.files.libraryDir`), lisible sans ToolBox :

- `Cours/Thermo/fichier.pdf` : un élément rangé (chemin = arbre des contextes ; les attributs ne sont jamais dans le chemin) ;
- `_Arrivée/` : déposé, pas encore rangé ;
- `_Corbeille/<id>/` : supprimé, récupérable.

Le Coffre **copie** ce qu'on y dépose : l'original n'est jamais modifié ni déplacé. Noms toujours valides sous Windows ; une collision donne « nom (2) ».

## Données (« prêt pour la synchro », pas de synchro réelle)

| Table                | Contenu                                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coffre__items`      | élément : `kind` (file / project / link), nom, `rel_path` (dans le coffre) ou `external_path` (lien), taille, `sha256`, `ext`, `context_id`, `arrival`, `pinned`, `trashed_at` / `trash_from`, `source_path` (l'original, information), `source_url` / `referrer_url` (Mark of the Web), `file_date` |
| `coffre__contexts`   | arbre : `parent_id`, nom, couleur (palette des catégories, `@hub/sdk/palette`), ordre, couverture                                                                                                                                                                                                    |
| `coffre__attributes` | élément, clé (nature, origin, language, application, prof, year, site, tag), valeur, origine `guessed` / `chosen`, raison                                                                                                                                                                            |
| `coffre__also`       | « aussi utilisé » : élément ↔ autre contexte                                                                                                                                                                                                                                                         |
| `coffre__changes`    | journal                                                                                                                                                                                                                                                                                              |

## API (`/api/modules/coffre`)

- `GET /home` · `GET /items?context=&key=&value=&arrival=1&trash=1` · `GET /items/:id` · `GET /contexts` · `GET /tools` (VS Code installé ?)
- `POST /deposit/analyze { paths, expand? }` : propositions (rien n'est écrit) · `POST /deposit/apply { entries }` : copies, fiches, `undoId`
- `PATCH /items/:id { name?, contextId?, newContext?, arrival?, pinned? }` (déplacement du fichier, retour arrière si échec) · `PUT /items/:id/attributes { key, values }` (« choisi ») · `POST /items/:id/guess` · `POST|DELETE /items/:id/also`
- `DELETE /items/:id` (corbeille) · `POST /items/:id/restore` · `POST /items/:id/erase { confirm: true }` (depuis la corbeille seulement) · `POST /undo { undoId }`
- `POST /items/:id/open { how: app | folder | vscode, runnable? }` : un exécutable seulement avec `runnable: true` (confirmation qui le nomme)
- `POST /contexts { name, parentId?, color? }` · `PATCH /contexts/:id { name?, color? }` (renommer = le dossier suit)
