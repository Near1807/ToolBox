# ToolBox sous Windows

## Récupérer le `.exe`

- **Version publiée** : page _Releases_ du dépôt GitHub, pour chaque tag `v*`.
- **Build de développement** : onglet _Actions_ → workflow « Build Windows » → dernière exécution → section _Artifacts_ (un `.zip` contenant les `.exe`).
- **Build local** (sous Windows uniquement : FFmpeg est téléchargé pour la plateforme qui installe) : `npm ci` puis `npm run dist:win` → `dist/`.

Deux variantes :

| Fichier                      | Usage                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ToolBox-Setup-x.y.z.exe`    | Installateur : raccourcis Bureau et menu Démarrer, désinstallation propre. **Recommandé.**                 |
| `ToolBox-Portable-x.y.z.exe` | Exécutable autonome, sans installation (plus lent au démarrage, car il se décompresse à chaque lancement). |

## Avertissement SmartScreen

L'application n'est **pas signée** (usage personnel ; un certificat de signature coûte plusieurs centaines d'euros par an). Au premier lancement, Windows affiche « Windows a protégé votre ordinateur ». Pour passer :

1. Cliquer sur **« Informations complémentaires »**.
2. Vérifier que le fichier est bien `ToolBox-Setup-….exe`, téléchargé depuis ton dépôt GitHub.
3. Cliquer sur **« Exécuter quand même »**.

Si le fichier a été téléchargé via un navigateur et que Windows le bloque complètement : clic droit sur le fichier → **Propriétés** → cocher **« Débloquer »** en bas de l'onglet Général → OK.

L'avertissement réapparaît à chaque nouvelle version (nouveau fichier non signé), c'est normal.

## Où sont mes données ?

- Données (base, bibliothèque, réglages, jetons chiffrés) : `%APPDATA%\ToolBox\` (le bouton « Ouvrir » de la page Réglages y mène directement).
- Les vidéos générées vont dans le dossier de sortie choisi dans les réglages.
- **Désinstaller l'app conserve les données.** Pour tout effacer, supprimer aussi `%APPDATA%\ToolBox\`.
- Les jetons de connexion (Google…) sont chiffrés avec la protection de données de Windows liée à ta session : ils ne sont pas lisibles depuis un autre compte ou un autre PC.
