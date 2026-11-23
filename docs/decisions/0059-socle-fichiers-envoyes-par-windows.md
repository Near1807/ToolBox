# 0059 — Socle : les fichiers envoyés par Windows (« Ranger dans ToolBox », « Envoyer vers »)

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règle 9), `docs/MODULES.md` §5.16, `docs/WINDOWS.md`

## Contexte

Thomas veut ranger un fichier dans le Coffre depuis l'explorateur, sans ouvrir ToolBox ni glisser : clic droit › « Ranger dans ToolBox », ou « Envoyer vers ». Sans droits d'administrateur, ajouté par l'installateur et retiré par la désinstallation.

## Décision

- **Registre par utilisateur** (`HKCU\Software\Classes\*\shell\ToolBox.Ranger` et `…\Directory\shell\ToolBox.Ranger`, commande `"ToolBox.exe" --ranger "%1"`, `MultiSelectModel = Player`) et un raccourci « Ranger dans ToolBox » dans `%APPDATA%\Microsoft\Windows\SendTo` (arguments `--ranger`). Pas de gestionnaire COM (`IExplorerCommand`) : il faudrait une DLL native signée ; sous Windows 11, l'entrée est donc dans « Afficher d'autres options ».
- **Installateur NSIS** (`resources/build/installer.nsh`, macros `customInstall` / `customUnInstall` d'electron-builder) : les ajoute ; la désinstallation les retire (sauf pendant une mise à jour, qui relance l'ancien désinstalleur : ils restent). Le choix de Thomas (« retiré » dans les Réglages) est gardé dans `HKCU\Software\ToolBox` (`ShellMenu = off`) : une mise à jour ne les remet pas.
- La **CI Windows** installe, vérifie les deux clés (commande comprise) et le raccourci, désinstalle, vérifie qu'ils ont disparu (et que les données restent).
- **Réglages › Général › Clic droit de Windows** : retirer / remettre (`HostAdapter.shellIntegration`, `electron/shell-integration.ts` : `reg.exe` et `shell.writeShortcutLink`, les mêmes noms que l'installateur). Absent hors de l'app de bureau sous Windows.
- **Instance unique** (déjà en place) : les arguments d'un second lancement arrivent dans `second-instance`. `pathsFromArgv` lit les chemins après `--ranger` (sans les options de Chromium ni le dossier de l'app) ; `FileBatcher` regroupe ce qui arrive en **1,5 s** (Windows lance ToolBox une fois par fichier sélectionné) : un lot = **une** fenêtre. ToolBox fermé : le premier lancement garde ses chemins jusqu'au chargement de la page.
- **Contrat générique** : `ctx.ui.receiveFiles(handler)` — un seul module reçoit (le premier qui le demande) ; il répond par la route qui montre les fichiers ; le socle met la fenêtre au premier plan sur cette route (`HostAdapter.showWindow`). Le Coffre garde le lot en mémoire (`/received/:id`) et ouvre la fenêtre de rangement (un dossier : la question « un projet / les fichiers un par un ») ; des fichiers qui arrivent pendant qu'elle est ouverte s'y ajoutent. **Rien n'est rangé sans le clic de Thomas** ; mêmes règles que le dépôt (copie, original intact, doublons).

## Conséquences

- Pas d'entrée de premier niveau dans le menu court de Windows 11 (demanderait une extension COM signée) : à reconsidérer si Thomas le demande.
- Version portable : rien n'est ajouté à son lancement ; le bouton des Réglages l'ajoute vers l'exe portable.
- Non testé en réel sous Windows dans cette session : le registre et le raccourci par la CI ; le clic droit lui-même est à essayer sur le PC (rapport).
