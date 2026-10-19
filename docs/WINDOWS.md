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

## Sauvegardes et restauration

- **Automatiques** : avant chaque mise à jour du schéma de la base, ToolBox copie `hub.db` dans `%APPDATA%\ToolBox\backups\` (10 dernières conservées). Si une mise à jour échoue, l'app restaure elle-même la copie et désactive l'outil concerné (message dans Réglages > Modules).
- **Manuelles** : Réglages > Sauvegardes > **Exporter une sauvegarde** crée un `.zip` avec la base et les fichiers des outils (morceaux, covers…). À faire avant une grosse manipulation, et de temps en temps sur un disque externe ou un cloud.

Restaurer à la main (app **fermée**, y compris dans la zone de notification) :

1. Ouvrir `%APPDATA%\ToolBox\` (Réglages > À propos > Ouvrir).
2. Mettre de côté le dossier actuel (le renommer, ex. `ToolBox-avant-restauration`).
3. Depuis un export `.zip` : recréer `%APPDATA%\ToolBox\`, y extraire `hub.db` et le dossier `modules\`.
   Depuis une sauvegarde automatique : copier `backups\hub-….db` vers `%APPDATA%\ToolBox\hub.db` (supprimer `hub.db-wal` et `hub.db-shm` s'ils existent).
4. Relancer ToolBox. Si un outil avait été désactivé, le réactiver dans Réglages > Modules.
