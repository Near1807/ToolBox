# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [sémantique](https://semver.org/lang/fr/).

## [Non publié]

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
