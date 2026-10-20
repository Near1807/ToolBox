# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [sémantique](https://semver.org/lang/fr/).

## [Non publié]

## [0.10.0] — 2026-10-20

### Ajouté

- **Plein écran** : F11 ou bouton « Plein écran » en bas de la barre latérale. En plein écran, l'app affiche ses propres boutons en haut à droite (réduire, quitter le plein écran, fermer) ; le choix est retenu au prochain lancement.

### Modifié

- La barre de titre Windows est sombre, assortie à l'app (elle était blanche).

## [0.9.0] — 2026-10-20

Reels en rythme : un mouvement hors rythme est pire que pas de mouvement.

### Modifié

- **Respiration des Reels pilotée directement par le son** : pour chaque image, énergie des basses (40–150 Hz), normalisée sur l'extrait, enveloppe à attaque instantanée (la cover est au plus grand sur l'image même du coup, jamais après) et retour doux de 160 ms, 1,8 % d'échelle au plus. Un passage calme ne bouge presque pas ; sans basses marquées, la cover reste immobile. Synchronisation mesurée : écart attaque → maximum ≤ 1 image (33 ms) sur des coups connus et sur de vrais morceaux (tableau dans le README du moteur vidéo, test automatique).
- **Rendu des Reels image par image** : dessin sur un canvas Skia (`@napi-rs/canvas`), images envoyées à FFmpeg ; fond, titre et artiste préparés une fois. Un Reel de 28 s se rend en ~30 s (4 cœurs). ADR 0017.
- Mise en page des Reels : cover dans une boîte de 660 px (y 800), zoom lent de 2 %.
- Les Reels faits avec la v0.8 sont marqués « À régénérer » ; les posts et la vidéo YouTube ne changent pas.
- Charte : « tout mouvement doit être piloté directement par le son, jamais par des événements détectés », avec mesure de synchronisation obligatoire.

### Ajouté

- **Visualisation sur le contour de la cover** (Reels) : fines barres vers l'extérieur le long du rectangle arrondi, basses en bas et aigus en haut, en miroir, teinte claire tirée de la cover, 5 % de la largeur de la cover au plus ; elles suivent la respiration. Le spectre horizontal reste sur YouTube.
- `npm run check:native` et le smoke test du `.exe` vérifient que le canvas charge et dessine.

### Supprimé

- La détection de temps forts (`beats.ts`) et la respiration en expression FFmpeg de la v0.8.

## [0.8.0] — 2026-10-20

Retour au sobre : un rendu solide avec n'importe quelle cover, sans faute de goût possible.

### Ajouté

- **Charte de direction artistique** `docs/DIRECTION-ARTISTIQUE.md`, obligatoire pour tout visuel généré : le son est le produit ; cover toujours entière (jamais de recadrage, de zoom sur un détail ni de détection de zones) ; seuls mouvements lents de l'image entière ; couleurs de la cover ; typographie discrète ; en cas de doute, faire moins. ADR 0016.
- Reels : **respiration** de la cover entière sur les temps forts de l'extrait (+1 à +1,5 %, montée douce, retour lent, sans à-coups).

### Modifié

- **Vidéo YouTube** revenue au design de base (cover arrondie avec ombre, titre et artiste dessous, visualisation en bas, zoom lent, fondus) : fond = cover agrandie juste assez puis très floutée et uniforme, adoucie, dégradé sombre en bas ; spectre logarithmique sur toute la largeur, lissé et plus discret. Aucun autre mouvement que le zoom lent.
- **Reels** : un seul style sobre, commun aux 4 Reels du pack, déclinaison verticale de la vidéo YouTube (cover entière ~70 % de la largeur, titre et artiste dessous, visualisation fine, fondus de 0,5 s, zones de sécurité). Les Reels faits avant sont marqués « À régénérer ».
- **Post** : fond, cover entière, titre et artiste ; la mention « Nouveau son » est retirée.
- True peak : marge de 0,1 dB (ebur128 n'affiche qu'une décimale), la bande-son est garantie ≤ -1 dBTP.

### Supprimé

- Les styles de Reels de la v0.7 (Révélation, Coupes sur le rythme, Phrase d'accroche, Ambiance) et leur code (carte des détails, recadrages, gros plans, particules, phrases d'accroche, menu de style), les réglages « Phrases d'accroche » et « Mention sur l'image du post ». Migration 4 d'`instagram-video` : suppression explicite des colonnes de style, ajout de `render_version`.

## [0.7.0] — 2026-10-20

Trois chantiers : vidéos déformées, Reels en quatre styles, suppression et synchronisation des fichiers générés.

### Corrigé

- **Vidéos déformées (étirées en largeur)** : les Reels sortaient avec un rapport de pixel de 16:9 (SAR) que les lecteurs appliquaient. Toutes les chaînes de filtres finissent désormais par `setsar=1` (Reels 1080×1920, YouTube 1920×1080, post 1080×1350) et la cover garde toujours son ratio d'origine (jamais étirée, jamais recadrée dans la carte). Test automatique au ffprobe : dimensions, SAR 1:1, DAR.
- **Son des masters très forts** : le codeur AAC par défaut dépassait le plafond de jusqu'à +5 dB, que la boucle true peak compensait en baissant le volume (jusqu'à -7 LU). Codeur « fast » : -1 dBTP tenu sans perte de volume.

### Ajouté

- **Reels en quatre styles**, un par Reel du pack, sans visualisation audio : **Révélation** (gros plan sur un détail, dézoom jusqu'à l'image entière), **Coupes sur le rythme** (4 à 6 cadrages, changements sur les attaques détectées), **Phrase d'accroche** (grand texte dès la 1re seconde, liste de phrases dans les réglages, modifiable par Reel), **Ambiance** (plein écran recadré sur les éléments importants, poussières, grain, barre de progression). Menu déroulant par Reel puis « Régénérer ». Titre et artiste discrets à contraste automatique, zones de sécurité Instagram, fondu de sortie 0,5 s.
- **Socle — `ctx.outputs`** : registre des fichiers générés par tous les modules. Suppression avec confirmation vers la **Corbeille**, sélection multiple, fichier effacé à la main signalé « Fichier introuvable » (« Retirer de la liste » ou « Régénérer »), « Nettoyer les éléments introuvables », nouvelle page **« Fichiers générés »**. Règle du contrat : tout fichier généré passe par `ctx.outputs` (MODULES.md §5.13, ADR 0014). Composants SDK : `OutputList`, `SelectionBar`, `MissingFile`, `useSelection`, `confirmDelete`.
- **Pack Instagram** : « Supprimer » sur chaque fichier, « Supprimer le pack », suppression des anciens Reels.
- **Vidéo YouTube** : « Supprimer », sélection multiple, vidéos introuvables.
- **Bibliothèque** : la fiche liste les fichiers générés par tous les modules ; supprimer un morceau propose de supprimer aussi ses fichiers.
- Module modèle : export d'une note en .txt enregistré dans `ctx.outputs`.

### Modifié

- Fichiers déjà générés : enregistrés dans le registre au démarrage, sans rien supprimer. Migration de la base : `core__outputs` (socle v2), styles des Reels (`instagram-video` v3).
- `recordOutput` de la Bibliothèque est déprécié (conservé pour compatibilité).

## [0.6.0] — 2026-10-19

Changement de périmètre de la phase 4 : le Reel unique devient un **pack Insta** par morceau.

### Ajouté

- **Pack Instagram** (`instagram-video`, remplace « Reel Instagram ») : « Générer le pack Insta » prépare, pour un morceau, **4 Reels** 9:16 de 28 s (réglable) sur 4 extraits différents, choisis parmi les passages les plus énergiques en évitant l'intro et l'outro, une **image de post 4:5** (1080×1350, JPEG) et une **légende**. Morceau trop court : avertissement et choix entre moins de Reels ou un léger chevauchement.
- Avant le rendu : les extraits en couleur sur la forme d'onde, déplaçables (glisser, clic, ±1 s), écoute et aperçu vidéo de chacun, nouvelle proposition automatique.
- Reels avec fondu image et son de 0,5 s ; fichiers « `<titre> - Reel 1.mp4` »… et « `<titre> - Post.jpg` » dans un dossier par morceau ; « Régénérer » un seul fichier ; « Ouvrir le dossier » du pack.
- **Légende** depuis un modèle réglable (`{titre}`, `{artiste}`, `{hashtags}`), modifiable, enregistrée, « Copier » ; option d'une légende par Reel.
- **Suivi de publication** : case « Publié » datée (modifiable) sur le post et chaque Reel, page **« À publier »** (tous morceaux), état « x/5 publiés » dans la liste et sur la fiche du morceau de la Bibliothèque.
- **Glisser un fichier hors de l'app** vers une autre fenêtre (Instagram dans le navigateur, l'Explorateur…) : `startFileDrag` dans le SDK (ADR 0013).
- Moteur vidéo : durée des fondus réglable (`fadeSeconds`) et image de post 4:5 (`renderPost`) dans le même style que les vidéos.
- Bibliothèque : lignes d'information fournies par d'autres modules sur la fiche d'un morceau (`registerTrackInfo`).

### Modifié

- Les Reels faits avec la v0.5 restent en base et sont listés sous « Anciens Reels ». Réglages du module renommés (durée d'un Reel, modèle de légende, mention du post).

## [0.5.1] — 2026-10-19

Retours sur la première vidéo YouTube (moteur vidéo : YouTube et Instagram en profitent).

### Modifié

- **Fond** : dégradé doux aux couleurs de la cover au lieu d'un agrandissement flouté (plus de grosses taches), assombri vers le bas pour la lisibilité de la visualisation.
- **Spectre** : mouvement réparti sur toute la largeur (échelle logarithmique 45 Hz–8 kHz, aigus relevés et amplitude compressée sur la seule visualisation), barres plus hautes.
- **Nom d'artiste** : plus grand, blanc opaque, ombre plus marquée.

### Corrigé

- **Niveau crête du son** : limiteur sur signal suréchantillonné avant l'encodage AAC, puis mesure du true peak de l'AAC encodé et ré-encodage si besoin : la bande-son ne dépasse jamais -1 dBTP (elle pouvait atteindre +0,4 dBFS).

## [0.5.0] — 2026-10-19

Phase 4 : le Reel Instagram.

### Ajouté

- **Reel Instagram** (`instagram-video`) : extrait vertical 1080×1920 d'un morceau (sert aussi de YouTube Short). Durée de 15 à 90 s (30 s par défaut, réglable), point de départ choisi sur une forme d'onde cliquable, **« Suggérer un passage »** (section la plus énergique, analyse RMS), écoute de l'extrait, aperçu de 6 s, rendu en tâche de fond, légende prête à copier (phrase d'appel et hashtags réglables).

### Corrigé

- Les rangées de boutons passent à la ligne au lieu de déborder sur les écrans étroits.

## [0.4.0] — 2026-10-19

Phases 2 et 3 : la section Musique prend vie.

### Ajouté

- **Bibliothèque** (`music-library`) : ajout de morceaux par glisser-déposer (son WAV/MP3/FLAC + cover JPG/PNG) ou par sélecteur, fichiers copiés dans ToolBox, métadonnées lues avec ffprobe (dont titre/artiste intégrés au fichier), grille avec recherche et mini-lecteur, fiche morceau (édition, cover, lecteur, vidéos générées, suppression), artiste par défaut réglable. Service `musicLibrary` pour les autres outils.
- **Moteur vidéo** (`video-engine`) : rendu unique partagé par les générateurs. Fond flouté, cover nette arrondie avec ombre et zoom lent, barres de spectre audio-réactives, titre et artiste en Montserrat (embarquée), grain, fondus image et son. H.264 + AAC, yuv420p, 30 i/s, débits recommandés YouTube/Instagram. Progression réelle, annulation, un rendu à la fois, aperçu rapide en basse résolution.
- **Vidéo YouTube** (`youtube-video`) : vidéo 16:9 du morceau entier, aperçu de 6 s, rendu en tâche de fond, titre et description prêts à copier (liens et hashtags réglables), « Ouvrir le dossier ». Publication directe préparée (pas encore active).
- Socle : URL signées pour afficher images, sons et vidéos ; assets propres aux modules (polices…) ; accès aux binaires FFmpeg/FFprobe ; sélecteurs de fichiers natifs et chemin des fichiers glissés-déposés.
- L'auto-test du `.exe` vérifie que tous les modules se chargent dans l'app empaquetée.
- Documentation : contrat de module complété, ADR 0012, README de chaque module.

### Modifié

- Les modules de service (sans page) n'apparaissent plus sur l'accueil (ils restent visibles dans Réglages › Modules).

## [0.2.0] — 2026-10-19

Phase 1 : le socle et le système de modules.

### Ajouté

- **Système de modules** : découverte automatique des dossiers `modules/*` au build, validation des manifests, dépendances entre modules et services (ordre de chargement, blocage en cascade, message clair), activation/désactivation dans les Réglages.
- **Contexte `ctx`** fourni aux modules : base SQLite avec migrations et tables préfixées, fichiers, réglages (dont secrets chiffrés), routes HTTP, tâches longues (progression, annulation, file d'attente), tâches planifiées avec rattrapage, bus d'événements, registre de services, journaux.
- **SDK `@hub/sdk`** (seul import autorisé aux modules) et règle ESLint qui fait respecter les frontières entre socle et modules.
- **Sécurité des données** : sauvegarde horodatée de `hub.db` avant toute migration (10 dernières conservées), restauration automatique et désactivation du module en cas d'échec de migration.
- **Réglages** : réglages généraux (dossier de sortie), liste des modules avec leur état, formulaires générés pour chaque module, **« Exporter une sauvegarde »** (.zip de la base et des fichiers des outils), liste des sauvegardes automatiques.
- Pages **Tâches** (suivi en temps réel) et **Journaux** (filtres par source et niveau).
- Accueil regroupé par sections, avec widgets des modules ; navigation latérale par section.
- Module modèle `modules/_template` (notes, réglage, tâche longue, tâche planifiée) et helper de test `@hub/sdk/testing`.
- Smoke test de la CI étendu : chargement d'un module, migration et route dans l'app empaquetée.
- Documentation : contrat de module complet (`docs/MODULES.md`), guide `docs/AJOUTER-UN-MODULE.md` avec « Intégrer une app existante », architecture du socle, ADR 0009 à 0011, procédure de restauration (`docs/WINDOWS.md`).

### Corrigé

- L'application ne se fermait pas complètement à la fermeture de la fenêtre (le process restait en arrière-plan).

## [0.1.0] — 2026-10-19

Phase 0 : squelette de l'application.

### Ajouté

- Coquille Electron (fenêtre unique, instance unique, liens externes ouverts dans le navigateur).
- Backend Fastify local lancé par le process principal, sécurisé : vérification `Host`/`Origin`, jeton de session, tickets à usage unique pour les flux SSE.
- Base SQLite (`hub.db` dans le dossier de données utilisateur) et FFmpeg/FFprobe embarqués (6.1 sous Windows).
- Interface React en mode sombre : accueil, navigation latérale, page Réglages (version, dossier de données, versions de SQLite/FFmpeg).
- Scripts `dev` (UI aussi utilisable dans un navigateur), `build`, `test`, `lint`, `typecheck`, `check:native`, `dist:win`.
- Packaging Windows : installateur NSIS et version portable (x64), non signés.
- Workflow GitHub Actions `build-windows.yml` : tests, build, smoke test du `.exe` empaqueté, artefacts, GitHub Release sur les tags `v*`.
- Documentation : `CLAUDE.md`, architecture, brouillon du contrat de module, feuille de route, guide Windows, ADR 0001 à 0008.
