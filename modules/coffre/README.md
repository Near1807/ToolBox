# Coffre (`coffre`, Expérimental)

Un seul endroit pour **garder, ranger, retrouver et ouvrir** les fichiers qui comptent. Cahier des charges complet : [`docs/coffre/CAHIER-DES-CHARGES.md`](../../docs/coffre/CAHIER-DES-CHARGES.md). ADR 0051 (socle), 0052 (modèle), 0053 (pages, rangement et lecteurs), 0054 (socle : dossier externe, copie de la base, indicateur), 0055 (le disque externe).

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
| `coffre__contexts`   | arbre : `parent_id`, nom, couleur (palette des catégories, `@hub/sdk/palette`), ordre, couverture ; v0.47.0 `course_name` (« Lié au cours … »)                                                                                                                                                       |
| `coffre__attributes` | élément, clé (nature, origin, language, application, prof, year, site, tag), valeur, origine `guessed` / `chosen`, raison                                                                                                                                                                            |
| `coffre__also`       | « aussi utilisé » : élément ↔ autre contexte                                                                                                                                                                                                                                                         |
| `coffre__changes`    | journal                                                                                                                                                                                                                                                                                              |
| `coffre__text`       | v0.47.0 : texte des éléments pour la recherche (FTS5, accents et casse ignorés) : `item_id`, `part` (page d'un PDF, diapositive, fichier d'un projet), `body`. Donnée **dérivée**, gardée sur le PC, jamais synchronisée                                                                             |
| `coffre__downloads`  | v0.47.0 : fichiers du dossier Téléchargements suivis (`baseline` = là avant l'activation, `waiting`, `pending` = proposé, `ignored`, `known` = déjà dans le Coffre, `ranged`), avec taille, date, empreinte. **État de ce PC**, jamais synchronisé                                                   |
| `coffre__rules`      | v0.47.0 : ce que le Coffre a appris (`kind` site / word / ext, `key`, `value` = contexte ou nature, `hits` confirmations, `misses` corrections) ; prêt pour la synchro. ADR 0061                                                                                                                     |
| `coffre__text_state` | v0.47.0 : pour chaque élément, l'empreinte dont le texte a été lu et son état (`ok`, `notext` = PDF scanné, `unsupported`, `toobig`, `error`)                                                                                                                                                        |

## API (`/api/modules/coffre`)

- `GET /home` · `GET /items?context=&key=&value=&arrival=1&trash=1` · `GET /items/:id` · `GET /contexts` · `GET /values` (valeurs déjà utilisées, par clé) · `GET /courses` (cours de l'Agenda, vide sans lui) · `GET /tools` (VS Code installé ?, réglage « Animations », dossier du Coffre)
- `POST /deposit/analyze { paths, expand? }` : propositions (rien n'est écrit) · `POST /deposit/apply { entries }` : copies, fiches, `undoId`
- `PATCH /items/:id { name?, contextId?, newContext?, arrival?, pinned? }` (déplacement du fichier, retour arrière si échec) · `PUT /items/:id/attributes { key, values }` (« choisi ») · `POST /items/:id/guess` · `POST|DELETE /items/:id/also`
- `DELETE /items/:id` (corbeille) · `POST /items/:id/restore` · `POST /items/:id/erase { confirm: true }` (depuis la corbeille seulement) · `POST /undo { undoId }`
- `POST /items/:id/open { how: app | folder | vscode, runnable? }` : un exécutable seulement avec `runnable: true` (confirmation qui le nomme)
- `POST /contexts { name, parentId?, color? }` · `PATCH /contexts/:id { name?, color?, coverItemId? }` (renommer = le dossier suit)
- v0.48.0 (ADR 0064) : `POST /contexts/:id/move { parentId }` · `POST /contexts/:id/merge { into }` · `DELETE /contexts/:id` (vide seulement) · `POST /contexts/:id/reorder { beforeId }` · `GET /contexts/:id/content` — fichiers et fiches ensemble (`backend/tree.ts`, journal d'opérations : retour arrière, `undoId`)
- v0.47.0 : `GET /now` (« Maintenant » : le cours de l'Agenda en cours ou dans 15 min, son contexte, ses éléments récents ; `null` sans Agenda) · `PATCH /contexts/:id { courseName }` (« Lié au cours … » ; `null` automatique, `-` aucun), ADR 0062
- v0.47.0 : `GET /learned` · `PATCH /learned/:id { contextId | nature }` · `DELETE /learned/:id` · `POST /learned/forget { confirm: true }` (« Tout oublier »)
- v0.47.0 : `GET /downloads` · `POST /downloads/check` (regarder maintenant) · `POST /downloads/ignore { paths }` · `GET /downloads/existing` (ceux d'avant l'activation, à la demande) — surveillance **désactivée par défaut** (réglages `watchDownloads`, `downloadsFolder`, `notifyDownloads`), ADR 0060
- v0.47.0 : `GET /search?q=&limit=` (noms, fiches **et contenu**, groupés par élément, extraits et pages, temps) · `GET /search/status` (lecture des textes) · `POST /search/refresh` (regarder les fichiers du PC maintenant) · `GET /items/:id/matches?q=` (les pages qui contiennent les mots)

## Pages (`frontend/`)

Toutes dans le même cadre (`frame.tsx`) : **glisser n'importe où** sur une page du Coffre ouvre la fenêtre de rangement (sur la page d'un contexte ou sur sa tuile : ce contexte est fixé) ; message avec « Annuler » ; aperçu par-dessus la page. v0.47.0 : Ctrl+K = la recherche du socle, partout (le Coffre est un fournisseur, `backend/search.ts`) ; le champ de l'accueil cherche aussi dans le contenu (`SearchResults.tsx`).

- `''` accueil (`Home.tsx`) : recherche (noms, fiches, attributs ; v0.47.0 : le contenu, résultats du serveur groupés par élément avec extraits et pages, pastilles), santé du coffre (jauge du disque du PC, éléments, place, corbeille ; disque de sauvegarde en v0.46), Arrivée (compteur, « Ranger » / « Tout est rangé »), « En cours » (épinglés), récents, tuiles des contextes par famille ;
- `c/:id` page d'un contexte : bandeau de sa couleur, couverture, cours de l'Agenda (code, profs, prochain créneau), sous-contextes, filtres en pastilles combinables, cartes ou liste triable (choix retenu sur le PC) ;
- v0.47.0 : `lire/:id` (la **fenêtre de lecture**, `ReaderPage.tsx`, ouverte par `POST /items/:id/read-window` → `ctx.ui.openWindow`, ADR 0058 : le lecteur seul, en mode `window` ; « Lire en plein écran » dans l'aperçu, sur la carte, au clic droit) ;
- v0.47.0 : `ranger/:lot` (fichiers envoyés par Windows, clic droit « Ranger dans ToolBox » ou « Envoyer vers », `Received.tsx` : la fenêtre de rangement avec tout le lot ; `GET /received/:id` ; le Coffre reçoit par `ctx.ui.receiveFiles`, ADR 0059) ;
- v0.47.0 : `chercher?q=` (les résultats, « Tous les résultats » de Ctrl+K) ; `voir/:id?page=&q=` (un résultat de Ctrl+K : l'aperçu ouvert à sa page, les mots surlignés) ;
- `v/:clé/:valeur` vue par attribut (« Python », « Prof PCH ») ; `arrivee` ; `corbeille` (Récupérer, Effacer définitivement après confirmation).

Fenêtre de rangement (`Deposit.tsx`) : aperçu à gauche, fiche pré-remplie à droite (`Sheet.tsx` : « deviné » + raison au survol, chaque champ en un clic par `Picker.tsx`, création d'un contexte « Cours › Réseaux » ou d'un tag sur place), Entrée = Ranger, « Ranger plus tard » (Arrivée), plusieurs fichiers : liste et « Tout valider » (sans proposition : Arrivée ; un doublon reste de côté tant qu'il n'est pas « gardé quand même »). Un dossier : « Un projet » ou « Les fichiers un par un ». Animation vers la tuile (`fly.ts`), coupée par le réglage « Animations » et par `prefers-reduced-motion`.

Carte (`Items.tsx`, `ReliefCard` du SDK) : aperçu, nom, nature, contexte (vues transverses), date ; au survol Ouvrir, Ouvrir dans…, Épingler ; clic droit : menu commun (Modifier la fiche, Changer de contexte, Épingler, couverture, Ouvrir avec l'application, Afficher dans l'explorateur, Supprimer). Espace ou clic sur l'aperçu : aperçu grand format (`Preview.tsx` : lecteur, fiche modifiable, ← →, Échap). Double-clic : son application ; un programme ou un script : jamais sans la question qui le nomme. v0.47.1 (`openPlan`, `frontend/logic.ts`) : un **fichier de code** (extension que le lecteur de code reconnaît) s'ouvre dans **VS Code** s'il est installé, sinon dans l'aperçu ; jamais dans l'application associée de Windows (qui pourrait le lancer) ; un projet : VS Code, sinon son dossier.

### Lecteurs (`frontend/readers/`)

Registre générique (`registry.ts`) : un lecteur = un fichier `<nom>.reader.tsx` qui appelle `registerReader({ id, extensions, maxBytes?, thumbMaxBytes?, priority?, component })` ; `readers/index.ts` les trouve tous (aucun autre changement). Fournis : PDF (pdf.js, `pdfjs-dist`, worker servi par l'app), images, texte, code coloré (`highlight.js`, langues choisies), Markdown (`markdown-it`, `html: false`, sans images, liens jamais suivis), vidéo et son (lecteurs du navigateur), HTML **isolé** (cadre `sandbox=""`, politique `default-src 'none'` : aucun script, aucune requête). Sans lecteur : l'icône de sa nature et « Ouvrir dans son application ».

v0.47.0 : un lecteur reçoit `locate` (ouvert depuis une recherche : sa page, ses mots, surlignés par `readers/mark.ts`) et `window` (dans la fenêtre de lecture). PDF : pages dessinées quand elles sont vues, couche de texte (sélectionnable, mots surlignés), zoom, « aller à la page », « Chercher dans le document » (↑ ↓) ; code : numéros de ligne ; Markdown : sommaire dans la fenêtre de lecture ; image : zoom.

## Recherche dans le contenu (v0.47.0, ADR 0056)

v0.47.1 : la lecture se fait **dans un worker** (`backend/extract.worker.ts`, `extract-pool.ts` : `worker_threads`, construit dans `build/main/workers/coffre/`, dépaqueté de l'asar) : le fil du serveur reste libre ; 60 s au plus par fichier (sinon « illisible : trop long », relu au démarrage suivant) ; un worker qui s'arrête est remplacé. Un `.docx`/`.pptx`/`.xlsx` n'est jamais décompressé au-delà de 100 Mo (par partie et en tout) ni au-delà de 10 000 parties (`unzipBounded`) : « illisible : trop gros ».

`backend/extract.ts` lit le texte (PDF par page avec pdf.js pour Node, Markdown, texte, HTML sans script ni style, code, `.docx`, `.pptx` par diapositive, `.xlsx` ; un projet : ses fichiers texte ; PDF scanné : « pas de texte », pas d'OCR) ; `backend/text-index.ts` le garde dans l'index FTS5, en arrière-plan (un fichier à la fois, pause de 30 ms, interrompu à la fermeture, repris au démarrage : ce qui reste = ce dont l'empreinte lue n'est pas l'actuelle). Déclencheurs : dépôt, regard sur les fichiers du PC (démarrage, avant une mise à jour du disque, toutes les 10 min), branchement du disque (archivés pas encore lus). Lit seulement le coffre, n'écrit que l'index. Progression dans la zone Santé.

Limites connues : les PDF à images JPEG 2000 ou à polices non incluses s'affichent sans ces images / avec des polices de remplacement (les fichiers WebAssembly et polices de pdf.js ne sont pas chargés : la politique de l'interface n'autorise pas WebAssembly).

## Le disque du coffre (v0.46, ADR 0055)

Réglages › Coffre › « Disque du coffre » : un dossier choisi sur le disque externe ; ToolBox y crée `ToolBox-Coffre/` et `_identite-toolbox-coffre.json`. Le disque est retrouvé par cette identité, jamais par sa lettre (sa dernière place, puis le même chemin sur chaque volume), toutes les 4 s, **en lecture seule** (`backend/volumes.ts`, `disk.ts`). Un seul disque pour l'instant (`coffre__disks` ; une copie par élément et par disque dans `coffre__copies`).

Sur le disque : le même arbre que sur le PC, et `_ToolBox/` :

- `Historique/<élément>/<date> nom` ;
- `Corbeille/<élément>/nom` ;
- `Base/hub.db`, `Base/fiches.json`, `Base/manifeste.json` ;
- `tmp/` (vidé au début de chaque mise à jour), `Deplacement/` et `Abimes/` ;
- `LISEZ-MOI.txt`.

| Partie                                                                                                                                             | Où                                                                        | Ce qui écrit (toujours un clic) |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| États (« pas encore sur le disque », actif, archivé), fichiers du PC modifiés (taille + date, puis empreinte ; fichier par fichier pour un projet) | `plan.ts`, `disk.ts` (`scanPc`, au démarrage et avant chaque mise à jour) | la base du PC seulement         |
| Mise à jour : plan, place, déplacements en deux temps, copies relues (`copy.ts`), historique, quota, base / fiches / manifeste                     | `update.ts` (tâche `disk-update`)                                         | « Mettre à jour »               |
| Versions, « Restaurer cette version » (confirmée, Annuler) ; corbeille du disque (récupérer, effacer confirmé, proposé après 30 jours)             | `history.ts`                                                              | les boutons                     |
| Archiver (les deux copies relues) / réactiver (place vérifiée) / copie en lecture / suggestions                                                    | `archive.ts`                                                              | les boutons                     |
| Restaurer depuis un disque (aperçu, sauvegarde de la base si des données, rien d'écrasé)                                                           | `restore.ts` (tâche `disk-restore`)                                       | « Restaurer » confirmé          |
| Vérifier le disque (relire toutes les empreintes), « Recopier depuis le PC »                                                                       | `verify.ts` (tâche `disk-verify`)                                         | « Vérifier », « Recopier »      |
| Éjecter (verbe « Éjecter » de Windows, puis contrôle)                                                                                              | `eject.ts`                                                                | « Éjecter le disque »           |

API : `GET /disk` (état, `?look=1`), `POST /disk/register|forget|update|eject|verify|repair`, `PATCH /disk`, `GET /disk/plan|trash|verify`, `POST /disk/trash/recover|erase`, `GET /items/:id/versions`, `POST /items/:id/versions/:vid/restore`, `POST /items/archive`, `POST /items/:id/reactivate|seen`, `GET /suggestions/archive`, `POST /restore/preview|apply`, `GET /items?state=pending|archived|suggest`.

Réglage : « Place réservée aux anciennes versions sur le disque (Go) », `historyQuotaGb`, 20 par défaut.

Pages : témoin du disque en haut des pages (`disk/DiskWitness.tsx`, « Mettre à jour »), point dans la barre latérale (`disk/DiskBadge.tsx`, `nav.badge`), plan / progression / compte rendu (`disk/UpdateDialog.tsx`), santé (`disk/Health.tsx`), vérification (`disk/VerifyDialog.tsx`), restauration (`disk/RestoreDialog.tsx`), versions dans l'aperçu (`disk/Versions.tsx`), corbeille du disque (`disk/DiskTrash.tsx`), réglages (`disk/DiskSettings.tsx`).
