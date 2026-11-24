# 0051 — Fichiers de l'utilisateur gardés par un module

- Statut : acceptée (v0.45.0)
- Date : 23/11/2026

## Contexte

Le Coffre (ADR 0052) garde les fichiers de Thomas : supports de cours, synthèses, code, contrats. Ce ne sont ni des **fichiers générés** (`ctx.outputs`, supprimables d'un clic, rattachés à un projet), ni les **données internes** d'un module (`ctx.files.dataDir`, `userData/modules/<id>`). Le cahier des charges veut un dossier lisible sans ToolBox, dans le dossier de données de ToolBox (`userData/coffre`), qui survit à la désinstallation. Il faut aussi lire la provenance d'un fichier téléchargé (Mark of the Web) et ouvrir des fichiers sans jamais lancer un programme par surprise.

## Décision

Trois ajouts génériques à `ctx.files` (`packages/sdk/core.ts`, `backend/core/files.ts`), documentés dans `docs/MODULES.md` §5.2 :

1. **`libraryDir` / `libraryPath(...)`** : `<userData>/<id>/`, à côté de `modules/` (jamais dans `modules/<id>`). Le dossier n'est créé que par le module qui l'utilise. Il est servi par `mediaUrl` (racines autorisées du `MediaSigner`), refuse tout chemin qui en sort, et refuse un identifiant de module qui serait un dossier du hub (`modules`, `backups`, `logs`, `outputs`, `sync`, `hub.db`). Absent sur le téléphone (`partly` : un usage y lève une erreur claire).
2. **`provenance(path)`** : lit le flux NTFS `:Zone.Identifier` d'un fichier (zone, `HostUrl`, `ReferrerUrl`) ; `null` sans marque. Analyse pure dans `parseZoneIdentifier` (`@hub/sdk/core`).
3. **`open(path, { runnable })`** : refuse un fichier qui lance quelque chose (programme, installateur, script, raccourci : `RUNNABLE_EXTENSIONS`, `isRunnable`) sans `runnable: true`, que le module ne passe qu'après une confirmation de l'utilisateur qui nomme le fichier. La règle vaut pour tous les modules : aucun module actuel n'ouvrait d'exécutable.

## Conséquences

- La désinstallation garde ce dossier comme le reste de `userData` (`deleteAppDataOnUninstall: false`, vérifié par le smoke test et un essai réel en CI).
- La sauvegarde de `hub.db` ne copie pas ces fichiers. Leur sauvegarde, c'est le disque externe du Coffre (v0.46).
- Écarté : mettre ces fichiers dans `dataDir` (chemin peu lisible, `modules/coffre/…`), ou dans le dossier de sortie (fait pour les fichiers générés, réglable et supprimable).
