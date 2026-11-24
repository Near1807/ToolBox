# 0056 — Coffre : la recherche dans le contenu (texte extrait, index FTS5 gardé sur le PC)

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règle 9), ADR 0052, ADR 0055, ADR 0057

## Contexte

Thomas veut retrouver un fichier par un mot qu'il contient (« transistor » dans une synthèse PDF), y compris pour un élément **archivé** (sur le disque externe, débranché). La recherche de v0.45 ne lisait que les noms, les fiches et les attributs, côté page.

## Décision

### Le texte est extrait et gardé sur le PC

- Formats lus : PDF (texte **par page**, avec son numéro), Markdown, texte, HTML (texte seulement : ni script, ni style, ni commentaire), code (les extensions connues du lecteur de code), Word / PowerPoint / Excel modernes (`.docx`, `.pptx` une partie par diapositive, `.xlsx` les textes des cellules) en lisant le XML du zip avec fflate (déjà présent). Un projet (dossier) : ses fichiers texte et code, une partie par fichier (chemin relatif), sans `node_modules`, `.git`, `build`…
- Un PDF sans aucun texte (scanné) est marqué « pas de texte ». **Pas d'OCR** (ni moteur, ni modèle à installer).
- PDF : pdf.js (`pdfjs-dist`, la même bibliothèque que le lecteur), sa version Node (`legacy/build/pdf.mjs`) chargée par Node lui-même (`require` d'un module ES, Node 22+), copiée par le build dans `build/main/pdfjs/` et dépaquetée de l'asar. Aucun script du PDF ne s'exécute (`isEvalSupported: false`).
- Limites : 20 Mo pour un fichier texte, 300 Mo pour un PDF ou un fichier Office, 400 000 caractères par partie, 2000 fichiers par projet.

### Un index FTS5, insensible aux accents et à la casse

- Migration 3 du Coffre (ajout seulement) : `coffre__text` (FTS5, `tokenize = 'unicode61 remove_diacritics 2'`, colonnes `item_id`, `part`, `body`) et `coffre__text_state` (empreinte lue, état `ok` / `notext` / `unsupported` / `toobig` / `error`).
- C'est une **donnée dérivée**, recalculable depuis les fichiers : jamais synchronisée, ni journalisée ; ses lignes d'un élément sont remplacées quand son texte est relu ; celles d'un élément effacé sont oubliées au démarrage.
- Gardé sur le PC : un élément archivé reste cherchable disque débranché (l'aperçu dit alors de brancher le disque).
- Requête : chaque mot, son début (`"mot"*`), tous les mots (`AND`) ; les guillemets de Thomas sont retirés (pas de syntaxe FTS exposée).

### Extraction en arrière-plan, priorité basse

- Au dépôt, à chaque modification détectée (le regard sur les fichiers du PC : au démarrage, avant une mise à jour du disque, et toutes les 10 minutes ; tailles et dates comparées, seul ce qui a changé est relu) et une fois pour les éléments existants (montée de version).
- Un fichier à la fois, une pause de 30 ms entre deux fichiers, un retour à la boucle d'événements entre deux pages d'un PDF ; interrompue à la fermeture ; **reprise au démarrage suivant** : ce qui reste est ce dont l'état ne correspond pas à l'empreinte actuelle.
- Un archivé disque débranché est lu plus tard, au branchement.
- **Lit seulement le coffre, n'écrit que l'index** (listé dans « Actions sans clic de Thomas »).
- La progression est visible dans la zone Santé (« Lecture des textes : 120 / 300 »), avec les PDF sans texte et les fichiers illisibles.

### La recherche est faite par le serveur

- `GET /api/modules/coffre/search?q=` : noms, fiches et contextes (comme avant), **et** le contenu ; groupés par élément (les noms d'abord, puis le contenu par pertinence BM25), au plus 5 extraits par élément avec les mots marqués (U+0001 … U+0002) et leur page.
- Temps mesuré : 3000 éléments, de 5 à 19 ms côté serveur (rapport v0.47.0).
- Ouvrir un résultat ouvre l'aperçu **à la bonne page**, le mot surligné (couche de texte de pdf.js) ; dans le PDF, « Chercher dans le document » avec ↑ ↓.
- Les filtres sont les pastilles du Coffre, sur les éléments trouvés.

## Conséquences

- La base grossit du texte des fichiers (quelques Ko par document en moyenne).
- Un PDF scanné reste introuvable par son contenu (pas d'OCR) : son nom et sa fiche restent cherchables.
- `.doc`, `.ppt`, `.xls` (anciens formats binaires), `.odt` : pas lus (plus tard si besoin).
- Changer ces règles : `modules/coffre/backend/extract.ts` (formats, limites), `text-index.ts` (index, priorité), `search.ts` (résultats).

## Note v0.47.1

- La lecture se fait dans un **worker** (`worker_threads`) : un gros fichier Office, lu d'un seul tenant, bloquait le fil du serveur plus d'une demi-seconde (mesure du rapport v0.47.1). 60 s au plus par fichier : au-delà, « illisible : trop long », relu une fois au démarrage suivant ; un worker qui s'arrête est remplacé.
- Fichiers Office : décompression **bornée** (100 Mo par partie et en tout, 10 000 parties), « illisible : trop gros » au-delà.
- pdf.js 6 n'a plus l'option `isEvalSupported` ni aucun chemin `eval` / `new Function` ; un test le vérifie à chaque mise à jour de pdf.js (aperçu et extraction), et la page de ToolBox interdit `eval`.
