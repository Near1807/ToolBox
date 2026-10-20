# 0013 — Glisser des fichiers hors de l'application

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Le pack Instagram (Reels, post image) se publie à la main, souvent depuis Instagram dans le navigateur : le plus simple est de faire glisser le fichier depuis ToolBox vers la page. Le DOM ne sait pas faire glisser un fichier local vers une autre application ; Electron le permet avec `webContents.startDrag`, qui ne peut être appelé que dans le process principal.

## Décision

- Capacité **générique du socle**, utilisable par tout module : `startFileDrag(mediaUrl)` dans `@hub/sdk/frontend`, exposée par le preload (`toolbox.startDrag`) et traitée par `ipcMain` (`toolbox:start-drag`) dans `electron/main.ts`.
- Le fichier est désigné par son **URL de média signée** (`ctx.files.mediaUrl`), jamais par un chemin libre : le process principal vérifie la signature HMAC (`hub.media.resolve`), donc seuls les fichiers des dossiers du hub, déjà présentés par un module, peuvent être glissés.
- Icône du glisser : une miniature pour les images, l'icône système du type de fichier sinon (`app.getFileIcon`).

## Conséquences

- C'est la seule exception à la règle « l'interface ne parle au backend que par l'API REST » ajoutée depuis la phase 0 ; elle reste minimale (un message IPC, une vérification).
- Dans un navigateur (dev), `startFileDrag` renvoie `false` : le module affiche alors « Ouvrir le dossier ».
