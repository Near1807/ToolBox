# 0014 — Registre des fichiers générés (`ctx.outputs`)

- Statut : acceptée
- Date : 2026-10-20

## Contexte

Jusqu'à la v0.6, chaque module tenait sa propre liste de fichiers générés (vidéos YouTube, Reels, post) et la Bibliothèque en gardait une copie (`recordOutput`). Rien ne pouvait être supprimé depuis l'app, et un fichier effacé dans l'Explorateur restait affiché. Chaque futur module aurait dû réinventer la suppression, la vérification sur le disque et la sélection multiple.

## Décision

- **Un registre unique dans le socle**, table `core__outputs` (module, `ref` de l'élément, `parent` facultatif, `subject` facultatif partagé entre modules, libellé, chemin, date, `missing_since`), exposé aux modules par `ctx.outputs` : `register`, `list`, `delete`, `forget`, `onRemoved`, `bySubject`, `deleteBySubject`.
- **Règle du contrat** : tout fichier qu'un module génère passe par `ctx.outputs` et est supprimable depuis l'interface (MODULES.md §5.13).
- **Suppression = Corbeille** (`shell.trashItem` via `HostAdapter.trashItem`) : réversible par l'utilisateur, jamais d'effacement définitif silencieux. Puis le socle appelle le `onRemoved` du module propriétaire, qui efface ou réinitialise **ses** données liées. Un filtre vide est refusé.
- **Synchronisation** : `exists` est vérifié sur le disque à chaque lecture (donc à chaque ouverture d'une vue) ; au démarrage, le socle compte les fichiers manquants (journal). « Retirer de la liste » (`forget`) et « Nettoyer les éléments introuvables » oublient les entrées sans toucher au disque.
- **Sujet partagé** (`subject`, ex. `music-library:track:7`) : la Bibliothèque liste les fichiers faits à partir d'un morceau, tous modules confondus, et peut les supprimer avec lui, sans connaître les modules qui les ont produits (règle d'or respectée).
- **Interface commune** dans le SDK : `outputs`, `confirmDelete`, `useSelection`, `SelectionBar`, `MissingFile`, `OutputList`, et une page du shell « Fichiers générés ».
- **Reprise de l'existant** : chaque module enregistre ses fichiers déjà produits au démarrage (`register` est idempotent, même chemin = mise à jour). Rien n'est supprimé. `recordOutput` de la Bibliothèque est conservé pour compatibilité mais déprécié.

## Conséquences

- Une suppression demandée par l'utilisateur, confirmée, est désormais une exception explicite à la règle « aucune suppression de données hors migration » (MODULES.md §6).
- Les fichiers privés d'un module (miniatures dans `dataDir`) restent gérés par le module lui-même, dans son `onRemoved`.
- Hors Electron (tests, backend autonome), `trashItem` efface le fichier : il n'y a pas de Corbeille.
