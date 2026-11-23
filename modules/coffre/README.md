# Coffre (`coffre`, Expérimental)

Un seul endroit pour **garder, ranger, retrouver et ouvrir** les fichiers qui comptent. Cahier des charges complet : [`docs/coffre/CAHIER-DES-CHARGES.md`](../../docs/coffre/CAHIER-DES-CHARGES.md). ADR 0051 (socle), 0052 (modèle), 0053 (pages, rangement et lecteurs).

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

- `GET /home` · `GET /items?context=&key=&value=&arrival=1&trash=1` · `GET /items/:id` · `GET /contexts` · `GET /values` (valeurs déjà utilisées, par clé) · `GET /courses` (cours de l'Agenda, vide sans lui) · `GET /tools` (VS Code installé ?, réglage « Animations », dossier du Coffre)
- `POST /deposit/analyze { paths, expand? }` : propositions (rien n'est écrit) · `POST /deposit/apply { entries }` : copies, fiches, `undoId`
- `PATCH /items/:id { name?, contextId?, newContext?, arrival?, pinned? }` (déplacement du fichier, retour arrière si échec) · `PUT /items/:id/attributes { key, values }` (« choisi ») · `POST /items/:id/guess` · `POST|DELETE /items/:id/also`
- `DELETE /items/:id` (corbeille) · `POST /items/:id/restore` · `POST /items/:id/erase { confirm: true }` (depuis la corbeille seulement) · `POST /undo { undoId }`
- `POST /items/:id/open { how: app | folder | vscode, runnable? }` : un exécutable seulement avec `runnable: true` (confirmation qui le nomme)
- `POST /contexts { name, parentId?, color? }` · `PATCH /contexts/:id { name?, color?, coverItemId? }` (renommer = le dossier suit)

## Pages (`frontend/`)

Toutes dans le même cadre (`frame.tsx`) : **glisser n'importe où** sur une page du Coffre ouvre la fenêtre de rangement (sur la page d'un contexte ou sur sa tuile : ce contexte est fixé) ; message avec « Annuler » ; aperçu par-dessus la page ; Ctrl+K = recherche du Coffre (avant celle de la barre latérale tant qu'une page du Coffre est ouverte).

- `''` accueil (`Home.tsx`) : recherche (noms, fiches, attributs), santé du coffre (jauge du disque du PC, éléments, place, corbeille ; disque de sauvegarde en v0.46), Arrivée (compteur, « Ranger » / « Tout est rangé »), « En cours » (épinglés), récents, tuiles des contextes par famille ;
- `c/:id` page d'un contexte : bandeau de sa couleur, couverture, cours de l'Agenda (code, profs, prochain créneau), sous-contextes, filtres en pastilles combinables, cartes ou liste triable (choix retenu sur le PC) ;
- `v/:clé/:valeur` vue par attribut (« Python », « Prof PCH ») ; `arrivee` ; `corbeille` (Récupérer, Effacer définitivement après confirmation).

Fenêtre de rangement (`Deposit.tsx`) : aperçu à gauche, fiche pré-remplie à droite (`Sheet.tsx` : « deviné » + raison au survol, chaque champ en un clic par `Picker.tsx`, création d'un contexte « Cours › Réseaux » ou d'un tag sur place), Entrée = Ranger, « Ranger plus tard » (Arrivée), plusieurs fichiers : liste et « Tout valider » (sans proposition : Arrivée ; un doublon reste de côté tant qu'il n'est pas « gardé quand même »). Un dossier : « Un projet » ou « Les fichiers un par un ». Animation vers la tuile (`fly.ts`), coupée par le réglage « Animations » et par `prefers-reduced-motion`.

Carte (`Items.tsx`, `ReliefCard` du SDK) : aperçu, nom, nature, contexte (vues transverses), date ; au survol Ouvrir, Ouvrir dans…, Épingler ; clic droit : menu commun (Modifier la fiche, Changer de contexte, Épingler, couverture, Ouvrir avec l'application, Afficher dans l'explorateur, Supprimer). Espace ou clic sur l'aperçu : aperçu grand format (`Preview.tsx` : lecteur, fiche modifiable, ← →, Échap). Double-clic : son application ; un programme ou un script : jamais sans la question qui le nomme.

### Lecteurs (`frontend/readers/`)

Registre générique (`registry.ts`) : un lecteur = un fichier `<nom>.reader.tsx` qui appelle `registerReader({ id, extensions, maxBytes?, thumbMaxBytes?, priority?, component })` ; `readers/index.ts` les trouve tous (aucun autre changement). Fournis : PDF (pdf.js, `pdfjs-dist`, worker servi par l'app), images, texte, code coloré (`highlight.js`, langues choisies), Markdown (`markdown-it`, `html: false`, sans images, liens jamais suivis), vidéo et son (lecteurs du navigateur), HTML **isolé** (cadre `sandbox=""`, politique `default-src 'none'` : aucun script, aucune requête). Sans lecteur : l'icône de sa nature et « Ouvrir dans son application ».

Limites connues : les PDF à images JPEG 2000 ou à polices non incluses s'affichent sans ces images / avec des polices de remplacement (les fichiers WebAssembly et polices de pdf.js ne sont pas chargés : la politique de l'interface n'autorise pas WebAssembly).
