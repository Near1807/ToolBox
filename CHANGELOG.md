# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [sémantique](https://semver.org/lang/fr/).

## [Non publié]

## [0.16.0] — 2026-10-23

Deux nouveaux modules dans la section **Outils** : To-do et Assistant vocal (V1), 100 % gratuits et locaux.

### Ajouté

- **To-do** (`todo`) :
  - tâches avec tags (suggestions des tags existants) et échéance en langage naturel (« demain », « vendredi prochain », « dans 3 jours », « le 12 novembre »), case « Fait », date de création ;
  - rattachement facultatif à un morceau, visible sur la fiche du morceau ;
  - ajout rapide au clavier (« finir le mix #mix vendredi » + Entrée, avec aperçu), modification sur place, suppression confirmée, « Annuler » ;
  - vues à faire / faites, filtre par tag, retards bien visibles ;
  - widget « à faire aujourd'hui ».
- **Assistant vocal** (`assistant`) :
  - chaîne 100 % locale : whisper.cpp, Ollama (appel d'outils), Piper ; voix dès la première phrase ;
  - talkie-walkie : touche maintenue, touche Copilot par défaut, configurable ; ou appui / appui ;
  - bouton micro et saisie au clavier ;
  - indicateur flottant toujours visible ;
  - historique avec « Annuler » et Oui / Non, latence de chaque maillon ;
  - matériel détecté et modèle recommandé, installation guidée avec progression ;
  - il agit sur la To-do, lit le Planning, les Stats YouTube, la Bibliothèque, le Pack Insta, les Reels perso et les tâches en cours, et ouvre les pages ; il refuse les actions sensibles en proposant la page.
- **Socle** :
  - `ctx.assistant` : chaque module expose ses actions ; niveaux de risque appliqués par le socle (lecture, modification annulable, suppression confirmée, sensible jamais exécutée) ;
  - `ctx.hotkeys` : touche globale maintenue (uiohook-napi) ;
  - `ctx.ui` : ouvrir une page, indicateur flottant ;
  - composants `Background` et `Overlay` des modules ;
  - réglages cachés ;
  - permissions de l'interface limitées au micro.
- SDK : `matchByName` (noms approximatifs, ambiguïté signalée), `UndoToast`, `ELEMENT_STATES`, `listPhrase`.
- Actions de lecture pour l'assistant dans la Bibliothèque, le Planning, Stats YouTube, le Pack Insta et les Reels perso.
- ADR 0028, 0029.

## [0.15.0] — 2026-10-23

Nouveau module **Stats YouTube** (`youtube-stats`, section Musique).

### Ajouté

- **Stats YouTube** : toutes les statistiques de la chaîne, stockées en local et croisées avec les morceaux, Shorts, extraits, effets et dates de publication.
  - Synchro au démarrage puis toutes les X heures (réglage), avec rattrapage de l'historique et relevé quotidien ; « Synchroniser maintenant » ; quota et jeton expiré gérés.
  - Autorisations en lecture seule ajoutées au compte Google existant (sans tout reconnecter).
  - Impressions et taux de clics : via l'API si Google les fournit, sinon import de l'export CSV de YouTube Studio (colonnes reconnues automatiquement, FR/EN, .csv ou .zip).
  - Liaison vidéo ↔ morceau automatique par le Planning ; manuelle avec suggestion par titre.
  - Quatre niveaux : Vue d'ensemble, Morceaux, Vidéos (fiche complète), Labo (rétention × musique, J+1/3/7/30, effet des Shorts sur la vidéo, extraits, styles, jour × heure, conversion, cycle de vie, anomalies).
  - Théories : hypothèses avec effectif, test et niveau de confiance (Intuition / Piste / Solide), suggestions d'expérience, journal confirmé / infirmé / en attente.
  - Mode démo clairement signalé « DONNÉES DE DÉMO ».
- Planning de sortie : service `releasePlanner` (`listYouTubeItems`) ; Pack Insta : `startSec` des Reels ; Reels perso : `intensity` et `audioMode` dans le service.
- ADR 0027.

## [0.14.2] — 2026-10-22

Suite de l'audit : décisions de Thomas sur les propositions de la v0.14.1.

### Modifié

- **Liste des morceaux** de Vidéo YouTube, Pack Insta et Reels perso : un seul composant partagé du SDK (`TrackList`). Petites harmonisations : « ♪ » centré dans la vignette sans cover, la vignette vide des Reels perso affiche aussi « ♪ », arrondi des lignes pris dans le thème.
- **Tests en deux niveaux** : `npm test` (rapides, ~17 s) pendant le travail, `npm run test:full` (avec les rendus complets, ~100 s), toujours lancée par la CI Windows.
- ROADMAP : maintenance décidée (electron-builder, versions majeures) et propositions écartées.

## [0.14.1] — 2026-10-22

Session de nettoyage et d'audit du code : aucun changement visible (mêmes fonctions, mêmes rendus, mêmes données).

### Modifié

- SDK : aides `idParam` et `requestBody` pour les routes, `ctx.files.mediaUrlIfExists` (remplacent du code recopié dans quatre modules).
- Dépendances : Electron 44.9.3, Vite 8.3.5, @fastify/static 10.1.7, typescript-eslint 8.72.0 (correctifs et mineures).
- CLAUDE.md : section « Hygiène du code » (passe de nettoyage toutes les 3 à 4 sessions).

### Retiré

- Code mort : classes CSS, symboles et trois routes jamais appelés par l'interface (`music-library` `/outputs/:id/open|reveal`, `custom-reels` `GET /storage`).

### Corrigé

- Test du Planning « coupure réseau » instable sous charge (il lisait les appels Google avant la fin des envois).
- L'attente entre deux essais d'envoi YouTube ne laisse plus d'écouteur d'annulation derrière elle ; avertissement de dépréciation Fastify supprimé.

### Données

- Aucune migration. Les colonnes `sync_*` des vidéos de « Reels depuis mes vidéos » (prototype v0.13) restent en base, plus lues par le code.

## [0.14.0] — 2026-10-22

Reels depuis mes vidéos en version finale : passage choisi par son départ, grand lecteur, son au choix, Caméra embarquée.

### Ajouté

- **Son au choix par Reel perso** : extrait du morceau, son de la vidéo (normalisé à -14 LUFS), ou « Morceau synchronisé » (le master calé là où le morceau joue dans la vidéo, cherché sur le passage choisi, au millième près ; repli « Son de la vidéo » si la confiance est faible). Toujours limité à -1,1 dBTP.
- **Effet « Caméra embarquée »** (l'écran filmé au téléphone en dansant) et **Intensité** Léger / Moyen / À fond pour Rythme et Caméra embarquée ; tout mouvement piloté par le son final, cadre toujours rempli.
- **Texte à l'écran** par Reel, discret, dans la zone de sécurité.
- **Passage vidéo par son départ** : sa durée est toujours celle du Reel ; fenêtre de largeur fixe sur la pellicule (glisser ou cliquer), « de 1:12 à 1:40 », première et dernière image ; passages enchaînés en option avancée (somme = durée du Reel).
- **Grand lecteur**, pellicule zoomable (×1 à ×8) avec tête de lecture, **« Lire le passage »** avec le son du mode, sans rendu.
- SDK : composant partagé `FilmstripWindow`.

### Corrigé

- Reels perso : la vidéo dure exactement la durée du Reel (il pouvait manquer la dernière image).
- Rattachement d'un élément du Pack Insta : « Inclure dans la sortie » est conservé, et un seul élément rattaché vers un morceau sans pack ne déplace plus tout le pack.

### Données

- Migrations de « Reels depuis mes vidéos » : 3 (son, intensité, texte à l'écran ; prototype) et 4 (synchro par passage) — ajouts de colonnes seulement, sauvegarde automatique avant chacune. Les passages enregistrés avant (début, fin) sont relus sans migration.

## [0.13.0] — 2026-10-22

Modules indépendants, rattachement « Sans projet » complet, Reel perso ajouté à une sortie planifiée, place disque des vidéos importées.

### Ajouté

- **Services facultatifs** (socle) : `dependsOn.optionalServices` et `ctx.services.optional()`. Règle du contrat : un module n'exige que ce sans quoi il n'a aucun sens (ADR 0024).
- **Rattachement complet** : rattacher un élément « Sans projet » met aussi à jour la ligne du module (vidéo, pack, Reel perso, miniature), par le nouveau crochet obligatoire `ctx.outputs.onReattach`, tout ou rien ; un refus (place déjà prise) est expliqué (ADR 0025). Service `musicLibrary.trackIdOf`.
- **Planning : « Ajouter un Reel perso »** sur une sortie déjà planifiée : Reel, Reel Insta et/ou Short, date proposée sur un jour autorisé (un jour non autorisé est refusé).
- **Reels perso : libérer la place** : place occupée par les vidéos importées (morceau, total, déjà libéré) ; après génération, « Supprimer la copie » (Corbeille) ou « Garder » ; « Réimporter » pour modifier un Reel dont la copie a été supprimée. Réglage « Proposer de supprimer la copie des vidéos importées ».
- SDK : `formatBytes`. Vue projet : groupe « Vidéos importées » (`kind: 'source'`).

### Modifié

- Le Planning de sortie n'exige plus que la Bibliothèque : Vidéo YouTube, Pack Instagram, Reels perso et moteur vidéo sont facultatifs (désactiver « Reels depuis mes vidéos » ne désactive plus le Planning).
- Les copies des vidéos importées passent par `ctx.outputs` : « Retirer » une vidéo l'envoie à la Corbeille.

### Données

- Migration 2 de « Reels depuis mes vidéos » : colonnes `size_bytes`, `removed_at`, `keep_copy` (ajouts seulement, sauvegarde automatique avant).

## [0.12.0] — 2026-10-21

Nouveau look et thèmes, barre latérale à catégories, textes modifiables sur place, projets par morceau, Reels depuis mes vidéos, Planning amélioré.

### Ajouté

- **Thèmes de l'interface** (Réglages › Apparence, changement immédiat, retenu) : Nebula (repris de GameLife, par défaut), Console, Studio, Minuit, Clair. Tout passe par des variables CSS (un fichier par thème, `docs/THEMES.md`) ; polices et icônes embarquées ; barre de titre Windows claire ou sombre selon le thème.
- **Composants partagés** du SDK (carte d'élément généré, miniature à glisser, état, case « Publié », actions, forme d'onde des extraits, champs de texte) utilisés par tous les modules.
- **Barre latérale à catégories** : repliables, créées, renommées, supprimées, réordonnées ; outils déplacés par glisser-déposer ou clic droit ; recherche (Ctrl+K) ; « Tout replier » ; l'accueil suit les mêmes catégories.
- **Textes modifiables sous l'élément** (titre, description, légende, tags) : vidéo YouTube, pack Insta (légende du pack + légende de chaque Reel), Reels perso, panneau du Planning. Les modèles ne font que pré-remplir ; « Enregistrer comme modèle par défaut ».
- **Projets** : chaque élément généré appartient à un morceau ; la page du morceau montre tout ce qui a été généré, groupé par type, avec son état (généré / planifié / programmé / publié) et la case « Inclure dans la sortie ». Section « Sans projet » (rattacher ou supprimer).
- **Module « Reels depuis mes vidéos »** (`custom-reels`) : tes vidéos (glisser-déposer), 1 à 4 Reels, extrait 15–60 s, passages sur une timeline ou enchaînés, cadrage 9:16 sans recadrage automatique (vidéo entière + fond flou, ou « remplir » autour d'un point), effets Brut / Calme / Rythme / Ciné avec aperçu, seul le son du morceau.
- **Planning de sortie** : alertes J-3 / J-1 pour les vidéos YouTube pas encore envoyées ; notification immédiate « À programmer dans Studio » avec le lien ; « Vérifier sur YouTube maintenant » ; envoi automatique (désactivé par défaut) ; jours de publication autorisés et « J tombe toujours un lundi » ; Reels perso ajoutables ; seuls les éléments inclus sont proposés.
- Fermer la fenêtre pendant un envoi (ou un rendu) demande confirmation.
- Socle : réglage de type `weekdays` ; préférences d'interface (`GET/PUT /api/core/ui`) ; `ctx.outputs.orphans` / `attach`.

### Modifié

- Nouveau modèle de plan par défaut : J vidéo YouTube + post ; J+1 à J+4 Reel n + Short n.
- `subject` est désormais **obligatoire** dans `ctx.outputs.register` (le projet de l'élément).
- Aucune couleur écrite en dur dans l'interface (contrôle ajouté à `npm run lint`).

### Corrigé

- Planning : déplacer la date d'une vidéo envoyée en « Privée » ne change plus rien sur YouTube (seulement le calendrier).

### Données

- Migrations (sauvegarde automatique avant chacune, aucune donnée supprimée) : socle 4 (projet choisi à la main), Bibliothèque 2 (inclusion dans la sortie), Vidéo YouTube 2 (textes par morceau), Planning 2 et 3 (textes qui suivent les modèles, Reels perso, alertes, envoi automatique), Reels perso 1.

## [0.11.1] — 2026-10-20

### Ajouté

- **Site public** (GitHub Pages, dossier `site/`, déployé depuis `hub-v1`) : page d'accueil et politique de confidentialité FR/EN de ToolBox, exigées par Google pour passer l'écran de consentement OAuth en Production. <https://near1807.github.io/ToolBox/>.
- Aide « Compte Google » et README du Planning de sortie : marche à suivre complète dans la console Google (Branding avec ces URL, passage en Production sans validation, écran « application non validée »).

### Modifié

- **Autorisation Google expirée ou retirée** (ex. 7 jours en mode « Test ») :
  - bandeau « Compte Google à reconnecter » avec bouton **Reconnecter**, et alerte sur le widget de l'accueil ;
  - une notification Windows par expiration ;
  - les envois restent **en attente** (au lieu d'échouer) et repartent après la reconnexion. L'expiration est détectée aussi sans vidéo à vérifier (contrôle toutes les 30 min).
- Google injoignable après les nouvelles tentatives : l'envoi est retenté 15 min plus tard au lieu d'échouer.

## [0.11.0] — 2026-10-20

Planning de sortie : YouTube programmé à l'avance, Instagram avec rappels.

### Ajouté

- **Module « Planning de sortie »** (`release-planner`, section Musique) :
  - **calendrier** mois / semaine de tout ce qui est planifié, tous morceaux confondus : icône par plateforme (vidéo YouTube, Short, post Insta, Reel), couleur par morceau, **glisser-déposer** pour déplacer ;
  - **« Planifier un morceau »** : jour J et heure ; plan proposé par un modèle réglable (J : vidéo + post ; J+2 Reel 1 ; J+3 Short 1 … J+14 Short 4), chaque date modifiable ;
  - **anti-embouteillage** : N publications max par jour et par plateforme, décalage automatique signalé.
  - **Publication YouTube** :
    - vidéo 16:9 et les 4 Reels en **Shorts** envoyés à l'avance et **programmés sur YouTube** (`publishAt`, heure de Bruxelles convertie, changements d'heure compris) ;
    - upload résumable avec progression, **reprise après coupure** (même après redémarrage), nouvelles tentatives, annulation ;
    - métadonnées préremplies par des modèles et modifiables avant l'envoi ; catégorie Musique, « conçue pour les enfants » : non ;
    - miniature personnalisée faite depuis la cover (avertissement si la chaîne n'y a pas droit) ; playlist facultative ;
    - statut relu sur YouTube toutes les 30 min ; date d'une vidéo déjà programmée déplaçable (`videos.update`).
  - **Quota YouTube** : envois et unités comptés par jour (minuit, heure du Pacifique), limites réglables (6 envois/jour par défaut), file d'attente étalée sur plusieurs jours avec message clair.
  - **Projet Google non audité** : si YouTube garde une vidéo privée sans date, elle passe en « À programmer dans Studio » avec lien direct et rappel.
  - **Instagram** :
    - vue **« Aujourd'hui »** et **widget d'accueil** : fichier à glisser, « Copier la légende », case « Publié » synchronisée avec le pack Insta ;
    - « en retard » quand la date passe ;
    - **notifications Windows** à l'heure prévue et au démarrage.
  - Éléments liés aux fichiers par `ctx.outputs` : fichier supprimé ou introuvable signalé, « Régénérer » ou « Retirer ». Une vidéo déjà en ligne n'est jamais supprimée sans choix explicite.
  - Écran d'aide **Compte Google** pas à pas : projet Google Cloud, API YouTube Data v3, identifiants « Application de bureau », écran de consentement en Production (sinon expiration au bout de 7 jours).
- **Socle** :
  - **`ctx.accounts`** : comptes OAuth (Google) en flux pour application installée (navigateur + boucle locale 127.0.0.1 + PKCE). Jetons chiffrés (safeStorage) dans `core__accounts` (migration 3 du socle, additive). Client OAuth saisi dans Réglages › Comptes connectés. Réutilisable par `youtube-stats`. ADR 0018.
  - **`ctx.notifications`** : notifications Windows qui ouvrent une page du module.
  - Réglage **« Lancer ToolBox au démarrage de Windows »** (désactivé par défaut) : démarrage réduit dans la zone de notification, fermer la fenêtre l'y garde. ADR 0019.
- Services : `youtubeVideo` (Vidéo YouTube), `instagramPack` (Pack Instagram), `videoEngine.renderThumbnail` (miniature 1280×720).

### Modifié

- Vidéo YouTube : le bouton grisé « Publier sur YouTube » est remplacé par le lien « Sur YouTube » d'une vidéo envoyée par le Planning de sortie ; `backend/upload.ts` (emplacement jamais implémenté) est retiré. ADR 0020.

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
