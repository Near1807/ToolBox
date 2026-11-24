# 0065 — Coffre : importer une arborescence existante (copie ou adoption)

- Statut : acceptée (v0.48.0, marqué « Expérimental »)
- Date : 24/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règles 2, 6, 11), ADR 0052, ADR 0064

## Contexte

Thomas veut faire entrer d'un coup une grosse arborescence (« Programmation ») : ses sous-dossiers deviennent des contextes, ses fichiers vont au bon endroit, et le dossier du coffre reproduit l'arbre des contextes. Il arrive aussi qu'un dossier soit copié à la main dans le coffre.

## Décision

- **Aperçu d'abord, rien d'écrit** (`POST /import/preview`) : l'arbre des contextes à créer sous une route (sélecteur de route, racine par défaut), les fichiers et la taille par dossier, les doublons par empreinte (lus seulement quand la taille correspond déjà à un élément ou à un autre fichier de l'import), les fichiers système et temporaires ignorés (`Thumbs.db`, `desktop.ini`, `~$…`, `.tmp`, `.crdownload`…), les contextes existants qui reçoivent des fichiers (fusion).
- **Projets de code = un seul élément.**
  - Repérés par un marqueur : `.git`, `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `platformio.ini`, `CMakeLists.txt`, `*.sln`, `*.csproj`, `go.mod`… ou par leurs fichiers (au moins deux fichiers de code, au moins la moitié de leurs fichiers).
  - Une case par dossier permet de changer d'avis.
  - Les dépendances et dossiers de compilation (`node_modules`, `.venv`, `__pycache__`, `.pio` partout ; `build`, `dist`, `target`, `bin`, `obj`… dans un projet seulement) sont signalés et **décochés par défaut**.
- **Copie, jamais de déplacement** : l'original n'est jamais modifié. Chaque fichier est copié sous un nom temporaire, relu (empreinte), puis mis en place sous un nom libre (« (2) »).
- **Adoption** d'un dossier déjà dans le coffre (copié à la main) :
  - ToolBox le remarque au démarrage et toutes les 10 minutes, et le **propose** (bandeau dans Gestion, témoin dans Contenu) ; il ne l'adopte **jamais seul** ;
  - adopter crée les contextes et les fiches **sans copier ni déplacer** ;
  - « Annuler » une adoption ne retire que les fiches.
- **Arrière-plan** :
  - une tâche du socle (progression, « Annuler l'import ») ;
  - le plan et l'avancement sont gardés dans `coffre__imports` (migration 7, état de ce PC, jamais synchronisé) : un import interrompu par la fermeture de ToolBox **reprend** au démarrage suivant, là où il s'était arrêté. Un fichier déjà mis en place, dont la fiche n'avait pas été écrite, est repris tel quel (même empreinte) : aucun doublon « (2) » ;
  - annuler pendant l'import retire tout ce qu'il avait fait.
- **« À compléter »** :
  - chaque élément importé reçoit les déductions habituelles (« deviné ») et la marque `to_complete` ;
  - vue « À compléter » (témoin dans Contenu) ; la marque disparaît avec « Fiche vérifiée » (aperçu) ou « Modifier la sélection » (case « Marquer leurs fiches comme vérifiées »).
- **Un seul « Annuler »** pour l'import entier : les fiches, les contextes créés (s'ils sont vides) et les fichiers copiés.
- **Noms** : un dossier dont le nom n'est pas un nom de contexte valide (trop long, caractère refusé par Windows) devient un contexte au nom corrigé, signalé dans l'aperçu.

## Conséquences

- Les projets (explorateur, suivi en place, exclusions fichier par fichier) restent pour la v0.49.0. Rien ici ne les empêche : un projet importé est un élément `project` ordinaire, et ses exclusions sont un plan enregistré.
- Limite : 60 000 fichiers par import (au-delà : refus clair, importer par parties).
