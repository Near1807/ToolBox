# 0067 — Coffre : « tout est dossier » (remplace contextes, éléments et attributs)

- Statut : acceptée (v0.50.0, nouveautés marquées « Expérimental »)
- Date : 26/11/2026
- Remplace, pour le modèle : ADR 0052 (fiche et contextes), 0064 (arbre des contextes), 0065 (import d'arborescence). Le reste de ces ADR (disque, tâches, lecteurs) reste valable.
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (réécrit) ; rapport v0.50.0 (inventaire de l'ancien modèle).

## Contexte

Après usage des v0.45 à v0.48, Thomas trouve le modèle du Coffre confus. Contextes, éléments « projet », dossiers dans les projets, attributs et tags se ressemblent mais se comportent différemment, et l'import décidait seul de découper un dossier. Tout ce qu'il avait mis dans le Coffre était une copie : il l'a vidé (« Réinitialiser le Coffre », v0.49) pour repartir de zéro.

## Décision

1. **L'arborescence classique de Windows.** Un **dossier** est un vrai dossier du Coffre du PC (et du disque), sa **route** est son chemin. Un fichier est dans un seul dossier (« aussi utilisé dans » est retiré). La nouveauté du Coffre est dans l'accès : carte, recherche, étiquettes, aperçus, sauvegarde.
2. **Étiquettes** (remplacent attributs et tags) : par famille (`nature`, `language`, `year`, `origin`, `site`, `course`, `prof`, `free`), plusieurs valeurs par famille, chacune avec son origine : `guessed` (raison), `chosen` (jamais remplacée par une déduction), `default` (étiquette par défaut du dossier). Les étiquettes par défaut d'un dossier (`default_labels_json`) valent pour ses sous-dossiers ; la plus proche l'emporte ; jamais appliquées aux fichiers déjà là sans clic. Ensembles d'étiquettes nommés : table `coffre__label_sets`.
3. **Fin de route** et **Projet** sont deux **badges d'un dossier** (`end_of_route`, `project`). Poser ou enlever un badge ne déplace aucun fichier sur le PC. Un projet est indivisible : il se déplace, s'archive, se réactive et se supprime entier.
4. **Le contenu d'un projet est une seule entrée** (`coffre__items`, `kind = 'project'`, chemin = celui du dossier) : c'est elle que le disque copie, archive et vérifie, et que la recherche lit. Ainsi les mécanismes du disque (v0.46) et de la recherche (v0.47) restent inchangés. Les fichiers intérieurs d'un projet ne sont pas des lignes en v0.50 : le projet les montre en lisant son dossier, en lecture. Le suivi fichier par fichier (manifeste) et la recherche des fichiers intérieurs un par un sont prévus en v0.51.
   - Poser Projet sur un dossier qui a déjà des fichiers et des sous-dossiers rangés : leurs lignes sont **repliées** dans l'entrée du projet (suppression logique, « Annuler »). Enlever Projet les **déplie** : sous-dossiers et fichiers redeviennent des lignes, étiquettes déduites de nouveau. Rien ne bouge sur le PC. Sur le disque, à la prochaine mise à jour, l'ancienne forme passe dans la corbeille du disque et la nouvelle est copiée (rien n'est effacé).
   - Les dossiers cachés (nom en point, recréables) d'un dossier **qui n'est pas un projet** ne sont pas des lignes : ils restent sur le PC mais ne sont pas sauvegardés. Dans un projet, `.git` est sauvegardé (l'entrée copie le dossier entier, moins les exclus).
5. **À ranger** remplace Arrivée : un fichier sans dossier (`folder_id` vide), rangé sur le PC dans `_À ranger`.
6. **Original** : chaque dépôt retient `source_path` et `source_sha256` (l'empreinte de l'original au dépôt), pour la v0.52.
7. **Retirés** : liens externes (un fichier laissé à sa place, non sauvegardé), « à compléter », import d'arborescence et adoption (un dossier se dépose tel quel, par la tâche de fond reprenable de la v0.49), couverture d'un contexte.
8. **Noms internes.** « Contexte » est renommé partout (`folder`, `coffre__folders`, routes `/folders`). L'entrée du Coffre garde son nom interne `item` (`coffre__items`, `ItemRow`) : c'est soit un fichier, soit le contenu d'un projet ; l'interface dit « fichier » ou « projet ». Les routes de l'API disent `/files`.

## Migration : une exception datée (v0.50.0, décidée par Thomas)

La règle générale reste : **aucune suppression de données hors migration explicite**, et une migration publiée ne change jamais. Exception, **limitée aux anciennes tables et colonnes du Coffre**, pour la migration 8 du Coffre :

- **Condition** : un Coffre **vide**. Aucune ligne active (`deleted_at IS NULL`) dans les anciennes tables du Coffre (éléments, contextes, attributs, « aussi utilisé », copies, versions), et le dossier du Coffre sur le PC vide (ses dossiers techniques vides `_Arrivée`, `_Corbeille`, `_ToolBox` mis à part ; la migration le lit par `db.libraryDir`, jamais ne l'écrit).
- **Sinon** : refus (`MigrationRefusal`, nouveau dans le socle, générique) : rien n'est touché, le Coffre n'est pas chargé à ce démarrage avec un message clair (réinstaller la v0.49.0, « Réinitialiser le Coffre », revenir), mais il reste activé : la migration est retentée au démarrage suivant. Un bouton vers « Réinitialiser le Coffre » n'est pas possible : il fait partie du Coffre, qui ne se charge pas, et l'ancien code est retiré (choix de Thomas, rapport v0.50.0).
- **Si la condition tient** (après la sauvegarde automatique de la base, faite par le socle avant toute migration) : les anciennes tables sont **supprimées**, y compris leurs lignes logiquement supprimées par la réinitialisation (qui restent dans la sauvegarde), et les nouvelles créées. Les règles apprises qui visaient un contexte sont retirées (plus de cible) ; les autres restent.
- **Conservés** : l'enregistrement du disque (`coffre__disks` : identité, quota, réglages) et les réglages du Coffre. Le journal de synchro `coffre__changes` reste.

## Conséquences

- Plus de cohabitation : l'ancien code (contextes, attributs, « aussi utilisé », import, adoption, liens externes) est retiré, pas désactivé ; la preuve de nettoyage est dans le rapport v0.50.0.
- Le disque, l'historique, les corbeilles, la restauration, la vérification, les lecteurs, la recherche plein texte, les tâches de fond, le clic droit de Windows, Téléchargements, le sélecteur de route, « Pour tous » et la carte restent ; ils portent sur des dossiers.
- Un dossier avec des milliers de fichiers devient des milliers de lignes ; un projet reste une seule entrée.
