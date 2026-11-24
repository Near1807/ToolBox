# 0055 — Coffre : le disque externe (identité, états, mise à jour sûre, historique, corbeille, restauration)

- Statut : acceptée (v0.46.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règle 8), ADR 0052, ADR 0054

## Contexte

Avant v0.46, le Coffre n'avait aucune sauvegarde. Thomas a un disque dur USB (NTFS, 1 To, déjà en partie rempli) ; plus tard peut-être un SSD, un second disque ou un NAS. Ce qui ne doit jamais arriver : perdre un fichier (débranchement, coupure, plantage pendant une copie) ; avoir deux versions d'un élément sans savoir laquelle est la bonne ; remplir le PC ou le disque sans prévenir.

## Décision

### Le disque est un dossier reconnu par son identité

- Thomas choisit un dossier ; ToolBox y crée `ToolBox-Coffre/` et `_identite-toolbox-coffre.json` (identifiant, nom, date).
- Le disque est retrouvé par cet identifiant, **jamais par sa lettre** : on cherche d'abord à sa dernière place, puis au même chemin relatif sur chaque volume (E:, F:…).
- Cette recherche passe toutes les 4 s, en **lecture seule**, en asynchrone et avec une limite de temps : un lecteur endormi ne bloque pas ToolBox.
- Une table `coffre__disks` et une ligne par élément et par disque (`coffre__copies`) : rien n'empêche un second disque plus tard.

### Sur le disque, le même arbre que sur le PC

- `ToolBox-Coffre/Cours/Thermo/x.pdf`, `_Arrivée/`, lisibles sans ToolBox.
- ToolBox garde ses propres affaires dans `_ToolBox/` :
  - `Historique/<élément>/<date> nom` : anciennes versions ;
  - `Corbeille/<élément>/nom` : corbeille du disque ;
  - `Base/` : copie de la base, fiches en JSON, manifeste ;
  - `tmp/` : copies en cours ;
  - `Deplacement/` : déplacements en cours ;
  - `Abimes/` : fichiers abîmés mis de côté.
- Un contexte ne peut pas s'appeler `_ToolBox` (`folderName`).

### Trois états, calculés

- « Pas encore sur le disque » : aucune copie, ou une empreinte différente. C'est le seul état fragile, toujours visible.
- « Actif » : sur le PC et sur le disque, même empreinte.
- « Archivé » : sur le disque seulement.
- Les liens externes ne sont pas sauvegardés.
- Une modification faite sur le PC (même par une autre application) se voit à la taille et à la date (`stat_json`, fichier par fichier pour un projet), puis se confirme par l'empreinte. Ce contrôle a lieu au démarrage et avant chaque mise à jour.

### Mise à jour : un clic, jamais automatique

1. Un plan est calculé : copier, mettre à jour, déplacer, vers la corbeille. Si la place manque, refus **avant** d'écrire quoi que ce soit.
2. Chaque copie suit le même déroulé (`backend/copy.ts`) :
   - lecture par morceaux (n'importe quelle taille) avec calcul de l'empreinte ;
   - écriture sous un nom temporaire dans `_ToolBox/tmp`, puis `fsync` ;
   - **relecture** et comparaison des empreintes ;
   - enfin renommage à sa place, **sans jamais remplacer** un fichier.
3. Une annulation ou un débranchement laisse le disque cohérent. Ce qui est copié reste valide (la base n'enregistre une copie qu'une fois en place) ; le reste se fait à la prochaine mise à jour, qui commence par vider `_ToolBox/tmp`. Un fichier temporaire n'est jamais pris pour un bon.
4. Une version modifiée envoie l'ancienne dans l'historique, jamais écrasée.
5. Les déplacements et renommages se font en deux temps (`_ToolBox/Deplacement`, puis la place finale) : deux éléments qui échangent leurs noms ne se gênent pas.
6. Les suppressions du PC partent dans la corbeille du disque.
7. À la fin, le disque reçoit une copie cohérente de la base (`ctx.db.snapshotTo`), les fiches en JSON et un manifeste. Il se suffit à lui-même.

### Historique avec un quota en Go (20 par défaut)

- Quand le quota est dépassé, les anciennes versions **les plus anciennes** partent d'abord (premier entré, premier sorti), pendant une mise à jour lancée par Thomas.
- Le quota ne touche **jamais** les fichiers actuels, les archives ni la corbeille du disque.
- Une version plus grosse que tout le quota est gardée et signalée ; elle ne fait rien retirer.

### Corbeille du disque

- Un élément y reste. Rien n'est effacé automatiquement : après 30 jours, ToolBox **propose** de l'effacer (liste, confirmation).
- On peut le récupérer tant qu'il y est.

### Archiver et réactiver

- Archiver demande le disque branché et un élément actif. Les deux copies sont relues : même empreinte sur le disque et sur le PC, **puis** la copie du PC est retirée. Si la vérification échoue, rien n'est retiré.
- Un archivé se lit depuis le disque (`ctx.files.allowMediaRoot`) et ne se modifie pas.
- Réactiver : place du PC vérifiée avant, copie du disque relue sur le PC.

### Restaurer depuis un disque

- Les fiches du Coffre sont reprises depuis le JSON du disque : ajoutées, ou remplacées après une sauvegarde de la base et une confirmation explicite. Les actifs sont recopiés sur le PC, empreintes vérifiées ; les archivés restent sur le disque.
- La copie de **toute** la base reste sur le disque. La restaurer entièrement (les autres modules aussi) serait un outil du socle, qui n'existe pas encore.

## Conséquences

- Migration 2 du Coffre, par ajout seulement :
  - colonnes `archived_at`, `stat_json` et `opened_at` dans `coffre__items` ;
  - tables `coffre__disks`, `coffre__copies` et `coffre__versions`.
- Les écritures sur le disque ne viennent que d'un clic : enregistrer, mettre à jour, archiver, réactiver, restaurer une version, récupérer ou effacer depuis la corbeille du disque, vérifier puis réparer.
- Sous Windows, Node gère les chemins longs (> 260 caractères) par le préfixe `\\?\` ; testé par la CI Windows.
