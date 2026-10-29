# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [sémantique](https://semver.org/lang/fr/).

## [Non publié]

## [0.23.0] — 2026-10-29

Session bêta : Sport et Courses améliorés d'après les essais réels (toujours expérimentaux), la fenêtre flottante glissée par le système, et les petits points en attente.

### Ajouté

- Sport (expérimental) : bibliothèque d'exercices (autocomplétion, fusion des doublons) ; liste ordonnée d'exercices par séance de la semaine type (séries × répétitions, charge, repos, note), copiée dans chaque séance et modifiable pour elle seule ; affichage rapide au clic (semaine, mois, accueil) ; une séance ajoutée à la main se supprime (confirmation, « Annuler ») ; export CSV / Markdown avec commentaire et exercices ; assistant « c'est quoi les exos de ma séance d'aujourd'hui » (lecture).
- Courses (expérimental) : démarre vide ; import / export JSON documenté (aperçu avant écriture, rien d'écrasé sans confirmation, ingrédients inconnus proposés à la création, sauvegarde avant import, aller-retour sans perte, exemple téléchargeable) ; nutrition facultative par ingrédient (pour 100 g / 100 ml) et calcul par portion, par jour et par période (incomplet signalé) ; prix de référence et coût estimé (par portion, tri et filtre « moins chers », période, liste) ; onglet « Résumé de la semaine » (moyennes, graphes, objectifs facultatifs, aucun conseil) ; une liste par période avec historique réutilisable ; pièces ↔ poids avec le poids d'une pièce. Migration 2 du module.

- To-do : service `uncompleteTask` (décocher, sur un clic dans le module appelant). Timer : « Annuler » juste après « Oui, la cocher », dans la fenêtre flottante et sur la page.
- Analyse du master : réglage « Export des données : virgule décimale (Excel en français) » pour `courbes.csv` (désactivé par défaut ; séparateur « ; »).

### Corrigé

- Fenêtre flottante : la poignée utilise le déplacement natif du système (précis, sans dérive, correct à 125 / 150 %) au lieu du suivi du curseur (ADR 0036, révision v0.23).

## [0.22.0] — 2026-10-29

Session prototype : deux règles pour la suite (synchro Android, calendrier général), la fenêtre flottante déplaçable, les Réglages en sections, et deux outils « Vie perso » à tester : Sport et Courses.

### Ajouté

- Règles « Prêt pour la synchro » et « Prêt pour le calendrier » : socle `ctx.calendar` et `GET /api/core/calendar` ; SDK `SyncStore` (UUID, dates, suppression logique, journal). Badge « Expérimental » (manifest `experimental`).
- Fenêtre flottante **déplaçable** (poignée ⠿) ou placée au choix (4 coins, bas centre, haut centre), position retenue et ramenée dans l'écran, « Verrouiller la position ». *Expérimental.*
- **Réglages** en sections : « Général » (général, apparence, fenêtre flottante, droits de l'assistant, comptes, modules, sauvegardes, à propos) puis une section par outil, groupées comme la barre latérale ; recherche dans tous les réglages (accents ignorés) qui mène au réglage ; bouton ⚙ sur la page de chaque outil ; dernière section retenue.

- **Sport** (nouveau module, catégorie Vie perso, *expérimental*) : semaine type appliquée aux semaines à venir (une modification vaut à partir de demain), séances « Fait » / « Pas fait », humeur, commentaire, heure et durée par séance, déplacement dans la semaine (glisser-déposer), séances ponctuelles, annulation ; vues semaine et mois, séances passées à valider en évidence ; bilan (semaine, mois, série de semaines complètes, humeur moyenne) ; export CSV / Markdown ; carte d'accueil ; assistant (lecture ; validation, humeur, commentaire, déplacement derrière « L'assistant peut valider et modifier les séances », désactivé). Prêt pour la synchro et pour le calendrier.

- **Courses** (nouveau module, catégorie Vie perso, *expérimental*) : ingrédients (unité, rayon, sans doublon, fusion), bibliothèque de repas (portions, ingrédients, tags, note, recherche), planning des repas d'une période par jour et moment (moments configurables), liste générée (quantités ajustées aux portions, additionnées, g ↔ kg et ml ↔ cl ↔ l, par rayon) + extras habituels ou à la main, cochable, copier / exporter ; carte d'accueil ; assistant (lecture ; « ajoute café aux extras », « mets risotto mardi soir » derrière « L'assistant peut modifier les repas et la liste de courses », désactivé). Prêt pour la synchro et pour le calendrier.
- To-do : laisse « … aux extras / à la liste de courses » aux Courses.

### Corrigé

- Fenêtre flottante : la dernière réponse de l'assistant restait affichée en permanence au-dessus du mini-timer. Chaque panneau a maintenant sa durée de vie (6 s pour une réponse, sauf une question).

## [0.21.0] — 2026-10-24

Quatre chantiers : les exports de l'Analyse du master (et le bouton « Exporter en HTML » qui ne donnait rien), la barre de commande écrite de l'assistant, la Boîte à idées, et le Timer qui pose « Tâche terminée ? » sans ouvrir l'app. Un seul système de fenêtre flottante pour tout.

### Ajouté

- **Analyse du master, exports** (ligne « Exporter » sous les chiffres clés, version comparée et profil de références au choix ; aucune mesure ne change) :
  - « Exporter le rapport (HTML)… » : un seul fichier, ouvrable partout, imprimable en PDF ; tous les chiffres en texte et tableaux (mesures, plateformes, sections et contrastes, repères regroupés en zones et liste complète en annexe, écarts entre versions et avec les références) ; graphes en images PNG intégrées (ligne de temps, spectrogramme, équilibre tonal, stéréo/mono, contrastes, versions) ; aucune interprétation ;
  - « Copier le résumé » : Markdown compact avec tous les chiffres clés ;
  - « Exporter les données complètes… » : zip `courbes.csv` (une ligne par 100 ms) + `analyse.json` ;
  - via « Enregistrer sous », dans le dossier de ton choix (socle : `ctx.files.saveAs`).
- **Assistant, barre de commande écrite** (désactivée tant qu'aucune touche n'est choisie) : par-dessus l'application en cours, sans afficher ToolBox ; Entrée envoie, Échap ferme ; même chemin que la voix (corrections, commandes, IA si activée, mêmes droits et confirmations, « Tu voulais dire … ? » et « Annuler » dans la barre) ; réponse affichée, lue à voix haute seulement avec le réglage (désactivé) ; déclencheur « Double appui » (délai réglable) ou « Appui simple », touche ou combinaison au choix, la même que le micro possible (avertissement en appui simple). ADR 0037.
- **Boîte à idées** (nouveau module, section Outils) : titre, texte en mise en forme simple, tags (suggestions, filtre multi-tags, couleurs, renommer, fusionner), morceau facultatif ; recherche sans accents, tri, « Une idée au hasard », archives, suppression avec « Annuler » ; « Transformer en tâche » si la To-do est là ; export Markdown ; carte d'accueil ; assistant : « idée : … #tag », « montre mes idées », « une idée au hasard » (ajout derrière le droit « L'assistant peut ajouter des idées », désactivé). ADR 0038.
- **Timer dans la fenêtre flottante** : « Tâche terminée : [titre] ? » avec « Oui, la cocher » / « Non » puis « Relancer (même programme) » / « Plus tard », sans ouvrir l'app (la question reste aussi sur la page) ; « Pause — 5 min » / « Au travail — 8 min » quelques secondes ; chaque élément désactivable.
- **Socle** : une seule fenêtre flottante partagée, panneaux empilés sans chevauchement (`FloatingPanel` : clics, clavier seulement pour un champ de texte) (ADR 0036) ; `ctx.hotkeys` : combinaisons de touches et plusieurs touches par module ; `ctx.files.saveAs` ; service `todo` : `createTask`.

### Modifié

- Reconnaissance des commandes : un tag écrit « #tag » est traité comme « avec le tag … » (« ajoute une tâche finir le mix #studio vendredi » est mieux reconnue).
- La To-do ne prend plus « note une idée … » pour une tâche.

### Corrigé

- **Analyse du master** : « Exporter (HTML) » écrivait le rapport dans le dossier de sortie sans rien montrer (ni boîte, ni message, ni fichier ouvert). Il passe maintenant par « Enregistrer sous » et affiche le chemin.
- **Timer** : le mini-timer plantait quand l'horloge passait la fin d'une session un instant avant le backend, et restait vide ensuite (aussi sur la carte d'accueil).

## [0.20.0] — 2026-10-24

L'Analyse du master devient lisible d'un coup d'œil (mêmes mesures, au chiffre près), et un nouvel outil : le Timer, avec le pomodoro incrémental pour briser la barrière du démarrage.

### Ajouté

- **Timer** (nouveau module, section Outils) :
  - timer simple (un clic sur une durée), sessions avec pauses (pomodoro : cycles ou durée totale, pause longue facultative), **pomodoro incrémental** (départ court, +X min ou +X % par cycle, plafond, pauses constantes) ;
  - aperçu avant de lancer (frise des cycles, durées, heure de fin estimée) ; préréglages enregistrables (« Pomodoro classique 25/5 » et « Démarrage doux 2 h » livrés) ;
  - temps calculé depuis l'heure réelle : continue si tu changes de page, reprend correctement après une fermeture de l'app ;
  - notification et son (cloche, bips ou aucun, volume réglable) à chaque changement de phase ; « Passer la pause », « +5 min » ;
  - tâche de la To-do facultative : à la fin, « Tâche terminée ? » → « Oui » la coche (ton clic), « Non » propose de relancer ou « Plus tard » ;
  - mini-timer flottant (indicateur toujours visible, désactivable), widget d'accueil, historique et temps passé par tâche ;
  - assistant : « combien de temps il reste » (lecture) ; lancer, préréglage, pause, reprendre, arrêter, passer la pause derrière le droit « L'assistant peut piloter le timer », désactivé par défaut. ADR 0035.
- **To-do** : bouton ⏱ « Lancer un timer » sur chaque tâche et temps de travail passé dessus (si le Timer est là) ; service `todo` pour les autres modules.

### Modifié

- **Analyse du master, présentation** (aucune mesure ne change : identiques octet par octet) :
  - l'analyse passe sous la liste des projets, en pleine largeur ;
  - en haut, les chiffres clés en grand (sonie intégrée, crête vraie, LRA, PLR, perte au mono, dépassements) ;
  - vues rangées par question (Volume et dynamique, Crêtes et saturation, Fréquences, Stéréo et mono, Structure et sections, Fichier), détail replié (« Voir le détail ») ;
  - ligne de temps : 4 pistes par défaut (forme d'onde, sonie, bandes, repères), les autres d'un clic, choix retenu ; pistes plus hautes, unités dans les titres, légendes complètes ;
  - tableaux : colonnes secondaires au choix (retenues), unités dans les en-têtes, écarts de 3 ou plus en gras, de moins de 1 en gris (sans texte) ;
  - Sections lisible sur un écran de portable (noms entiers ; une carte par section sur un écran étroit), contrastes en tableau (les barres en détail) ;
  - guide intégré et ses captures mis à jour (nouvelle partie « Lire la page : résumé, détail, écarts »).

### Corrigé

- Analyse du master : à 1 280 px de large, les noms des sections étaient tronqués (« Int », « Pa ») et le tableau débordait.

## [0.19.0] — 2026-10-24

Passe de nettoyage et d'audit (aucun changement visible), trois corrections demandées et le guide intégré de l'Analyse du master.

### Ajouté

- **Guide intégré de l'Analyse du master** : page séparée, ouverte seulement à la demande (bouton « Guide », ou un petit « ? » à côté de chaque graphe et de chaque mesure, qui ouvre la bonne section ; les « ? » se masquent dans les réglages du module). Prise en main en 5 minutes, chaque vue et ses gestes, chaque mesure et graphe (ce que c'est, unité, lecture), flux de travail (boucle de production, drop qui décolle, références et A/B, dossier surveillé), réglages, limites et pièges ; recherche (accents ignorés) ; six captures annotées de la vraie interface, refaites par `scripts/guide-captures.mjs`.
- Règle du contrat : un module complexe fournit un guide intégré, mis à jour à chaque changement d'interface (`docs/MODULES.md` §7.4, CLAUDE.md).

### Modifié

- **Écoute A/B** (Analyse du master › Références) : la plus forte des deux est baissée pour les entendre à la même sonie ; le volume n'est jamais monté (avant : la référence pouvait être montée, avec un risque d'écrêtage à la lecture).
- **Sauvegardes automatiques** : celles d'avant migration et celles d'avant suppression (`ctx.db.backup`) ont chacune leur rotation de 10 ; une série de suppressions ne pousse plus dehors les sauvegardes d'avant migration. Réglages › Sauvegardes les affiche à part, avec le nombre gardé.
- **Reels perso** : la vérification rapide du master suit le mode de son. En « Son de la vidéo », le master n'est pas vérifié (il n'est pas entendu) et c'est dit ; avec des Reels mêlés, la note indique ceux qui ne sont pas concernés.

### Corrigé

- Analyse du master : une durée arrondie pouvait s'afficher « 0:60 » au lieu de « 1:00 » (axe de la sonie superposée des versions, repères, rapports).
- Analyse du master : les analyses calculées restaient toutes en mémoire (le plafond de 6 ne valait que pour celles relues sur le disque) ; un ffprobe bloqué ne bloque plus l'analyse (délai de 30 s) ; deux passages du dossier surveillé ne peuvent plus se chevaucher et les fichiers disparus sont oubliés.
- Test `findTrackInVideo` instable sous charge (délai porté à 180 s).

### Retiré

- Code mort : aides dB inutilisées et `durationOf` (Analyse du master), `ageDays` (Stats YouTube), un paramètre superflu (Pack Insta).

### Sécurité

- `npm audit fix` : `fast-uri` (correctif) ; `npm audit` : 0 vulnérabilité.

## [0.18.0] — 2026-10-24

Un nouvel outil pour mesurer les masters, des Stats YouTube qui disent d'où vient chaque chiffre, un assistant qui comprend mieux les noms et les mots de Thomas, des sauvegardes plus légères.

### Ajouté

- **Analyse du master** (nouveau module, section Musique), sans jamais modifier l'audio :
  - projets (morceau de la Bibliothèque ou analyse libre), versions v1, v2… copiées dans l'app (supprimables vers la Corbeille), analyse en tâche de fond, cache par contenu ;
  - ligne de temps zoomable synchronisée à la lecture (forme d'onde, sonie momentanée et court terme, 7 bandes superposées ou empilées, spectrogramme, facteur de crête et PLR, largeur globale ou par bande, corrélation, mono, repères : crête vraie au-dessus d'un seuil réglable, écrêtages, phase, silences), clic = lecture, survol = valeurs exactes ;
  - sections automatiques (Intro, Montée, Drop, Pause, Outro…) modifiables à la main, mesures et contrastes par section ;
  - mesures globales (sonie intégrée, LRA, crête vraie, PLR, dépassements et écrêtages datés, normalisation Spotify / YouTube / Apple Music / SoundCloud / Deezer réglable, stéréo, mono par bande, équilibre tonal au tiers d'octave, hygiène technique) ;
  - versions alignées automatiquement (décalage réglable), écarts globaux, par section, par bande, carte des différences ;
  - profils de références, comparaison à sonie égale, écoute A/B à volume égal (seul le volume de lecture change) ;
  - export HTML ; dossier surveillé (désactivé par défaut, lecture seule) avec notification ;
  - mesures vérifiées contre `ebur128` de FFmpeg (±0,1) et sur signaux connus.
- **Intégrations facultatives** : carte « Analyse du master » sur la page d'un morceau (« Analyser », badge) ; vérification rapide non bloquante avant « Générer » dans Vidéo YouTube, Pack Insta, Reels perso (« Générer quand même » / « Voir l'analyse ») ; trois commandes de l'assistant en lecture (« comment est le master d'Obsidian », « où sont les crêtes », « compare les deux dernières versions »).
- **Stats YouTube** : bouton « Diagnostic » (chaque cause possible, avec l'action à faire), résumé après chaque synchronisation (demandé, reçu, modifié, dernière date, durée), deux sources affichées (« en direct (estimé) » et « données consolidées jusqu'au JJ/MM »), source de chaque nombre au survol, liste des imports CSV avec « Supprimer cet import » et « Supprimer toutes les données CSV » (confirmation détaillée, sauvegarde de la base avant).
- **Assistant** : mots attendus transmis à la reconnaissance vocale (liste modifiable), corrections « entendu → compris » avec la transcription brute et corrigée dans l'historique, page « Mots », surnoms des outils et des morceaux, noms reconnus au son (« obsidienne » → Obsidian) avec « Tu voulais dire … ? », choix entre deux commandes proches, signal « micro prêt », « ouvre l'application ».
- SDK : `ctx.db.backup(reason)`, `precheckTrack` et `usePrecheck`, `NotFoundError`, noms au son dans `matchByName`, `backup.exclude` dans le manifeste.

### Modifié

- **Planning** : « cette semaine » = semaine du calendrier (lundi → dimanche), en bilan (fait / en retard / à venir) ; « semaine prochaine », « 7 prochains jours », « aujourd'hui » distincts.
- **Stats YouTube** : les statistiques par vidéo sont demandées 4 à la fois (mesuré : 275 s → 74 s pour 100 vidéos à 300 ms par requête) ; la page se recharge à la fin d'une synchronisation ; la date limite des données consolidées est le dernier jour donné par YouTube.
- **Exporter une sauvegarde** : moteurs, modèles, voix, embeddings et téléchargements de l'assistant exclus (ils se retéléchargent en un clic), comme les analyses recalculables du master.
- Bibliothèque : la page projet range à part les masters importés et les rapports d'analyse.

### Corrigé

- **Stats YouTube figées après un import CSV** : les lignes créées par un CSV comptaient comme des jours déjà synchronisés, la synchronisation sautait les jours manquants (restés à 0 vue). Réparé par la migration 2 (prochaine synchro : tout l'historique une fois).
- Stats YouTube : un export CSV « totaux » (figé à sa date) passait avant les impressions de l'API ; un CSV importé après coup écrasait celles de l'API.

### Retiré

- Réglage caché `directReads` de l'assistant (remplacé depuis la v0.17 par le choix automatique).

### Données

- Migrations : `youtube_stats` 2 (provenance des nombres, imports d'avant repérés), `music_library` 3 (surnoms), `assistant` 2 (mots, corrections, surnoms), `master_analysis` 1 (nouveau). Aucune donnée supprimée.

## [0.17.0] — 2026-10-23

L'assistant vocal devient rapide et contrôlé : les demandes courantes sont des **commandes reconnues sans IA**, l'IA est facultative (désactivée par défaut) et l'assistant est **en lecture seule** tant que Thomas n'active pas ses droits un par un.

### Ajouté

- **Commandes standardisées** (contrat des modules, MODULES.md §5.15) :
  - chaque action peut déclarer des phrases d'exemple en français (`examples`) et un extracteur de paramètres en code (`extract`) ; aides partagées dans le SDK (`cleanUtterance`, `stripCommand`, `extractTags`, `extractTrailing`, `extractAfter`, `extractName`, `extractNumber`) ;
  - To-do (ajouter avec titre, tags, date et morceau ; lister aujourd'hui, semaine, en retard, par tag ; cocher ; supprimer), Planning (à publier aujourd'hui, cette semaine, en retard ; sortie d'un morceau), Stats YouTube (résumé, morceau, faits marquants), Bibliothèque (état d'un morceau, ouvrir sa fiche), Tâches (rendus en cours), navigation (« ouvre … »), « quelles sont les commandes ? » ;
  - reconnaissance stricte : par le sens (modèle d'embeddings multilingue local, ~120 Mo, téléchargé sur un clic) et par les mots ; exécutée seulement si le score est haut, nettement devant la 2e commande et les paramètres obligatoires trouvés ; seuil et écart réglables.
- **Interrupteur « IA »** (désactivé par défaut), sur la page et dans l'indicateur flottant : commande reconnue → exécutée sans IA ; sinon le modèle choisi (IA activée) ou « Je n'ai pas compris ta demande. » avec « Tu voulais dire : … ? » (jamais exécuté). IA désactivée : Ollama n'est ni appelé ni nécessaire.
- **Page « Commandes »** : par module, phrases, paramètres, risque, état ; recherche ; ajouter, modifier, supprimer ses phrases, masquer celles du module, rétablir ; avertissement de conflit ; « Tester une phrase » ; export / import du dictionnaire.
- **« C'était… »** dans l'historique sur une demande non comprise.
- **Droits de l'assistant**, désactivés par défaut : « ajouter et cocher des tâches », « supprimer des tâches » (le « oui » reste obligatoire), « lancer la synchronisation des stats YouTube » (nouvelle action). Sans le droit, rien n'est exécuté et l'assistant propose d'ouvrir les droits.
- Historique : mode (commande standardisée, IA, pas compris), commande et score, nombre de questions, temps des commandes et du modèle.
- **Instructions du modèle modifiables** (réglages avancés) : rétablir l'original, longueur affichée, parties ajoutées par l'app en lecture seule.
- **Quota YouTube : le Planning passe avant les Stats** : synchro reportée pendant les envois, minimale si des envois sont prévus dans les 24 h, réserve réglable jamais consommée, messages qui disent qui a consommé le quota.

### Modifié

- **L'assistant est en lecture seule par défaut** : ajouter, cocher et supprimer une tâche demandent d'activer le droit correspondant (avant : actifs d'office).
- **IA simplifiée** : instructions plus courtes et stables (le modèle ne demande jamais de confirmation ni de paramètre facultatif, au plus une question, une phrase courte), réponse coupée à 120 jetons (400 avant), outils présélectionnés, modèle gardé en mémoire (réglable), « Réponses directes » automatiques sans carte graphique dédiée, message clair quand le modèle est trop lent.
- Contrat : toute action `change` ou `destructive` déclare son propre droit (`right`).

### Données

- Migration 1 du module `assistant` (dictionnaire des commandes : phrases de Thomas, phrases masquées).
- Migration 4 du module `release-planner` (quota consommé par les autres modules).

## [0.16.1] — 2026-10-23

### Ajouté

- Règle permanente **« Contrôle et sécurité »** (CLAUDE.md, MODULES.md §1 bis, AJOUTER-UN-MODULE) :
  - le contrôle de Thomas avant l'autonomie ;
  - jamais de suppression, publication, modification en ligne, écrasement ou mise à jour sans confirmation ;
  - tout changement visible et, si possible, annulable ;
  - droits de l'assistant et des automatisations ajoutés un par un ;
  - nouvelles fonctions qui agissent seules livrées désactivées ;
  - section « Actions sans clic de Thomas » dans chaque rapport.

### Modifié

- Planning : déplacer un élément **déjà sur YouTube** (glisser dans le calendrier ou modifier sa date) demande maintenant confirmation, car la date change aussi en ligne.

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
