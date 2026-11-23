# Coffre — cahier des charges

> Référence des sessions du module « Coffre ». Écrit en v0.45.0 à partir de la demande de Thomas.
> Chaque point porte sa version : **v0.45** (fondations, cette session), **v0.46**, **v0.47**, **plus tard**.
> Ce qui change ici change dans le même commit que le code.

## But

UN endroit pour **garder, ranger, retrouver et ouvrir** tous les fichiers qui comptent pour Thomas : supports de cours des profs, ses synthèses, son code, ses rapports, ses contrats, ses fichiers d'applications. Aujourd'hui tout finit dans Téléchargements parce que ranger coûte une décision. Le Coffre rend le rangement **quasi gratuit** (une proposition déjà faite, Entrée pour valider) et la recherche **immédiate**.

Outil **PC seulement**. Rien en ligne, rien envoyé à l'extérieur. Interface « atelier tech » (fond sombre profond, une seule couleur vive pour ce qui compte, jauges, compteurs, cartes en relief), uniquement par les jetons du thème et les composants du SDK, lisible en thème clair et sombre.

## Vocabulaire

Un mot par notion, partout — code (en anglais entre parenthèses), documentation et interface.

| Mot                          | Sens                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Coffre du PC** (`library`) | Dossier dans le dossier de données de ToolBox : `userData/coffre`. Tout ToolBox reste dans un seul dossier. **Plus tard** : un réglage pour déplacer tout le dossier de données d'un bloc.                                                                                                                                                                                                                                                |
| **Coffre du disque** (v0.46) | Dossier dédié sur un disque externe (pas le disque entier).                                                                                                                                                                                                                                                                                                                                                                               |
| **Élément** (`item`)         | Ce que le coffre garde : un **fichier**, un **projet** (un dossier entier, par exemple un projet de code) ou un **lien externe** (un fichier ou un dossier laissé à sa place, non sauvegardé — FL Studio en attendant mieux).                                                                                                                                                                                                             |
| **Fiche**                    | Les informations d'un élément.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Contexte** (`context`)     | À quoi l'élément appartient. Arbre **peu profond** (Cours › Thermo ; Programmation › Rust › projet ; Musique › morceau ; Scouts › Camp 2027 ; Perso › Administratif). **Un seul** contexte par élément : sa « maison », qui décide de son emplacement sur le disque. Un élément peut être **« aussi utilisé »** dans un autre contexte : un lien, jamais une copie.                                                                       |
| **Attributs**                | Ce qu'est l'élément, autant qu'on veut : **nature** (support du prof, synthèse, rapport, code, examen, contrat, fichier d'application, document, image…), **origine** (donné par le prof / fait par moi / téléchargé), **langage**, **prof**, **année**, **tags** libres, **site** d'origine. Chaque attribut est une porte d'entrée : la vue « Python » montre tous les éléments Python de tous les contextes (navigation par facettes). |
| **Arrivée**                  | Éléments déposés, pas encore rangés. **Jamais un état d'erreur** : ils sont gardés et trouvables.                                                                                                                                                                                                                                                                                                                                         |
| **Lecteur** (`reader`)       | Code qui sait afficher un format (PDF, image, code, Markdown, texte, vidéo, son, HTML ; **plus tard** : le format de synthèse de Thomas).                                                                                                                                                                                                                                                                                                 |
| **États** (v0.46)            | « Pas encore sur le disque » (le seul état fragile, toujours visible), « actif » (PC et disque identiques), « archivé » (disque seulement).                                                                                                                                                                                                                                                                                               |
| **Corbeille du coffre**      | Éléments supprimés, récupérables ; l'effacement définitif est une action à part, confirmée.                                                                                                                                                                                                                                                                                                                                               |

## Règles

1. **Déductions** — tout champ deviné (contexte, nature, langage, prof, année, origine, site) reste modifiable. Une valeur **choisie** par Thomas n'est **jamais** remplacée ensuite par une déduction. Chaque valeur porte son origine : « deviné » (avec sa raison, visible au survol) ou « choisi ». Sans indice : rien n'est proposé, jamais au hasard. Les corrections servent à mieux proposer (**v0.47**).
2. **Le fichier sur le disque est lisible sans ToolBox** — chemin = arbre des contextes (`Cours/Thermo/fichier.pdf`). Les attributs ne sont **pas** dans le chemin : changer la nature ne déplace rien ; seul un changement de contexte déplace le fichier (une transaction : fichier et fiche ensemble, retour arrière si le déplacement échoue). Noms valides sous Windows (caractères interdits, noms réservés, longueur) ; une collision ne remplace jamais un fichier (suffixe « (2) »).
3. **Rien n'est supprimé sans confirmation** — supprimer = corbeille du coffre (avec « Annuler ») ; l'effacement définitif est une action à part, confirmée, jamais automatique. « Annuler » partout où c'est possible.
4. **Ouvrir** — ce qu'un lecteur sait afficher s'affiche ; le reste s'ouvre dans l'application associée de Windows. Un exécutable ou un script (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js` hors lecteur, `.lnk`, `.scr`, `.com`, `.jar`, `.reg`…) n'est **jamais** lancé sans une confirmation explicite qui le nomme. Le socle le vérifie aussi (refus sans confirmation).
5. **HTML** — affiché isolé : aucun accès réseau, aucun accès aux fichiers, aucun script pour un HTML qui ne vient pas de Thomas. À préciser en **v0.47** pour ses synthèses.
6. **L'original n'est jamais touché** — le coffre **copie** ; l'original reste où il était (empreinte vérifiée avant et après dans les tests).
7. **La désinstallation de ToolBox n'efface jamais le dossier de données** (coffre compris) — `deleteAppDataOnUninstall: false` dans `electron-builder.yml`, vérifié par le smoke test et par un vrai essai installation → désinstallation en CI Windows.
8. **Disque (v0.46, livré ; détail : ADR 0055)**
   - le coffre du disque est un dossier `ToolBox-Coffre` sur n'importe quel volume (rien ne dépend du matériel), avec le même arbre que sur le PC ; ToolBox y garde ses affaires dans `_ToolBox` (historique, corbeille, base, fichiers temporaires) ;
   - reconnu par un **fichier d'identité** (jamais par sa lettre) ; la recherche du disque ne fait que lire ;
   - mise à jour au branchement par **un clic** (jamais automatique, pas même en option) : plan détaillé et place vérifiée **avant** d'écrire ; chaque copie écrite sous un nom temporaire, relue, comparée, puis mise à sa place sans jamais rien remplacer ; annulation ou débranchement : le disque reste cohérent ;
   - archiver seulement disque branché, après copie relue et empreinte identique ; un archivé ne se modifie pas (le réactiver d'abord, place vérifiée) ;
   - fiches des archivés toujours sur le PC (grisées, « sur le disque dur », trouvables) ; texte extrait gardé sur le PC (recherche sans le disque) : **v0.47**, avec la recherche dans le contenu ;
   - un archivé s'ouvre en « Réactiver pour le modifier » ou en « Ouvrir une copie en lecture » (copie temporaire, retirée ensuite) ;
   - suggestions d'archivage (« pas ouverts depuis 6 mois ») : livrées en v0.46, jamais appliquées seules ;
   - historique des anciennes versions sur le disque, avec un **quota en Go** choisi par Thomas (20 par défaut) ; les plus anciennes supprimées d'abord, pendant une mise à jour ; le quota ne touche **jamais** aux fichiers actuels, aux archives ni à la corbeille du disque ; une version plus grosse que le quota est gardée et signalée ;
   - corbeille du disque : jamais d'effacement automatique ; après 30 jours, ToolBox **propose** de l'effacer (liste, confirmation) ;
   - le disque reçoit une copie des fiches et de la base : il se suffit à lui-même (« Restaurer depuis un disque » testé en réel) ;
   - jauges PC et disque ; « Éjecter le disque » ; vérification complète à la demande (relire les empreintes) ;
   - un seul disque pour l'instant (second disque / NAS **plus tard**).
9. **v0.47**
   - recherche dans le **contenu** (texte des PDF, Markdown, HTML, code) ;
   - lecture plein écran dans une **fenêtre séparée** (Alt+Tab possible) ;
   - « Ranger dans ToolBox » / « Envoyer vers » dans le clic droit de Windows (ajouté à l'installation, retiré à la désinstallation) ;
   - surveillance de Téléchargements, **désactivée par défaut** (attendre la fin des `.crdownload` / `.part`) ;
   - apprentissage des corrections ;
   - « Maintenant » (le cours en cours d'après l'Agenda) ;
   - suggestions d'archivage : **avancées en v0.46**.
10. **Plus tard**
    - format de synthèse en composants : bibliothèque **unique** et externe aux documents, vérification avec la ligne en cause, export HTML autonome qui embarque une copie figée, kit pour une IA fabriqué depuis la bibliothèque, mode « l'essentiel seulement » ;
    - liens Agenda / To-do ; dépôts Git rattachés ; vrais projets FL Studio avec leurs samples ; téléphone ; aperçu Office / LaTeX ;
    - déplacer tout le dossier de données de ToolBox d'un bloc ; second disque / NAS.

## v0.45 — fondations (cette session)

### A — Le module et ses données

- Module `coffre`, section « Outils », nom affiché « Coffre », **Expérimental**. PC seulement (`PC_ONLY_MODULES` : il manipule des fichiers et lance des applications), mais « prêt pour la synchro » : UUID, `created_at` / `updated_at`, suppression logique, journal `coffre__changes` ; pas de synchro réelle.
- Tables :
  - **éléments** : type (fichier / projet / lien externe), nom, chemin relatif dans le coffre ou chemin externe, taille, empreinte sha256, type de fichier (extension), dates, épinglé, dans Arrivée ou rangé, contexte ;
  - **contextes** : arbre (parent, nom, couleur de la palette des catégories de l'Agenda, ordre, couverture facultative) ;
  - **attributs** : élément, clé, valeur, origine « deviné » / « choisi », raison ;
  - **« aussi utilisé »** : élément ↔ autre contexte.
- Stockage : `userData/coffre/<arbre des contextes>/<nom>` ; Arrivée = `userData/coffre/_Arrivée/` ; corbeille = `userData/coffre/_Corbeille/`.
- Doublons : empreinte identique à un élément existant → le dire au dépôt (« déjà dans le coffre : Thermo › … ») avec « Ouvrir l'existant » / « Garder quand même ».
- Socle : ce qui manque pour garder des fichiers de l'utilisateur hors de `ctx.outputs` (ce ne sont pas des fichiers générés) est ajouté de façon générique (`ctx.files.libraryDir`, provenance d'un fichier, ouverture sûre des exécutables), documenté dans `docs/MODULES.md` et une ADR.

### B — Déposer et ranger

- Glisser un ou plusieurs fichiers / dossiers n'importe où sur la page du Coffre → la **fenêtre de rangement** s'ouvre tout de suite : aperçu à gauche, fiche pré-remplie à droite, chaque champ deviné marqué « deviné » avec sa raison au survol, chaque champ modifiable en un clic (liste avec recherche, création d'un contexte ou d'un tag sur place). **Entrée = Ranger** ; secondaire « Ranger plus tard » (→ Arrivée). Plusieurs fichiers : une liste, une proposition par fichier, « Tout valider ».
- Glisser sur la page ou la tuile d'un contexte → contexte déjà fixé.
- Un dossier déposé : « Un projet (le dossier entier) » ou « Les fichiers un par un ».
- « Ajouter un lien externe… » : fiche marquée « lien externe, non sauvegardé » partout.
- Déductions (toutes « deviné », modifiables) :
  - langage et nature depuis l'extension ;
  - origine « téléchargé » et site d'origine depuis la marque Windows « Mark of the Web » (flux `:Zone.Identifier`, `HostUrl` / `ReferrerUrl`), lue sur l'**original** avant la copie et gardée dans la fiche ; si un élément du même site est déjà rangé, proposer le même contexte ;
  - mots du nom du fichier qui correspondent à un contexte existant ou à un cours de l'Agenda (codes et noms de cours importés, enseignants) — lecture seule de l'Agenda par son service, s'il est là (dépendance facultative) ;
  - année depuis la date.
- Après « Ranger » : animation courte du fichier vers sa tuile, compteurs mis à jour, message avec « Annuler ». Animations courtes, désactivables (réglage), et respectant « réduire les animations » du système.

### C — Retrouver et voir

- **Accueil** (tableau de bord) : barre de recherche large (noms, fiches, attributs ; contenu en v0.47 ; Ctrl+K) ; « En cours » (épinglés, grandes cartes) puis récents ; « Arrivée » (compteur, « Ranger », réduit à « Tout est rangé » à zéro) ; contextes en tuiles regroupées par famille (couleur, nombre d'éléments, pastille « nouveau ») ; « Santé du coffre » (jauge de place du PC, nombre d'éléments, place occupée ; la place du disque est prévue pour v0.46).
- **Page d'un contexte** : en-tête (nom, couleur, couverture ; pour un cours de l'Agenda : code, profs, prochain créneau) ; **filtres en pastilles** combinables (nature, origine, langage, année, tags) ; grille de cartes ou liste compacte triable (choix retenu) ; déposer sur la page range ici.
- **Vues par attribut** (« Python », « Prof … ») : même écran, autre en-tête.
- **Carte** : aperçu (première page du PDF, début du code, image, icône pour le reste), nom, nature, contexte (en vue par attribut), date ; au survol : Ouvrir, Ouvrir dans…, Épingler ; clic droit (menu commun) : Modifier la fiche, Changer de contexte, Épingler, Ouvrir avec l'application, Afficher dans l'explorateur, Supprimer.
- **Aperçu grand format** (barre d'espace ou clic sur l'aperçu) : couche par-dessus la page, contenu par le lecteur du format, fiche modifiable sur le côté, ← → élément suivant / précédent, Échap ferme.
- **Lecteurs** : registre générique (formats acceptés + composant d'affichage) utilisé par les cartes et l'aperçu ; ajouter un lecteur ne demande aucun changement ailleurs. v0.45 : PDF (pdf.js, local), images, texte, code avec coloration, Markdown (rendu sûr, sans HTML brut), vidéo et son (lecteurs natifs), HTML isolé (sans script ni réseau).
- **Ouvrir dans l'application** : application associée de Windows (par le HostAdapter) ; règle des exécutables ; projet de code : « Ouvrir dans VS Code » si VS Code est installé, sinon le dossier dans l'explorateur.
- **Corbeille du coffre** : récupérer, effacer définitivement sur confirmation.

### D — Interface « atelier »

Composants du SDK, réutilisables ailleurs : jauge circulaire, compteur, carte en relief avec aperçu, pastille de filtre, tuile de contexte. Uniquement des jetons du thème ; une seule couleur vive (l'accent du thème) pour l'action et ce qui compte.

## Hors de v0.45 (rappel)

Tout le disque (v0.46), la recherche dans le contenu, la fenêtre séparée, le menu de Windows, la surveillance de Téléchargements, l'apprentissage, « Maintenant », les suggestions d'archivage (v0.47), et tout ce qui est marqué « plus tard ».
