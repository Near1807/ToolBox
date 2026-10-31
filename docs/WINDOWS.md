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

- **Automatiques** : avant chaque mise à jour du schéma de la base, ToolBox copie `hub.db` dans `%APPDATA%\ToolBox\backups\` (10 dernières conservées) ; avant certaines suppressions (imports des Stats YouTube…), une autre copie, comptée à part (10 dernières), qui ne remplace jamais celles d'avant mise à jour. Si une mise à jour échoue, l'app restaure elle-même la copie et désactive l'outil concerné (message dans Réglages > Modules).
- **Manuelles** : Réglages > Sauvegardes > **Exporter une sauvegarde** crée un `.zip` avec la base et les fichiers des outils (morceaux, covers…). À faire avant une grosse manipulation, et de temps en temps sur un disque externe ou un cloud.

Restaurer à la main (app **fermée**, y compris dans la zone de notification) :

1. Ouvrir `%APPDATA%\ToolBox\` (Réglages > À propos > Ouvrir).
2. Mettre de côté le dossier actuel (le renommer, ex. `ToolBox-avant-restauration`).
3. Depuis un export `.zip` : recréer `%APPDATA%\ToolBox\`, y extraire `hub.db` et le dossier `modules\`.
   Depuis une sauvegarde automatique : copier `backups\hub-….db` vers `%APPDATA%\ToolBox\hub.db` (supprimer `hub.db-wal` et `hub.db-shm` s'ils existent).
4. Relancer ToolBox. Si un outil avait été désactivé, le réactiver dans Réglages > Modules.

## Démarrage avec Windows et zone de notification

Réglages › Général › **« Lancer ToolBox au démarrage de Windows »** (désactivé par défaut) :

- ToolBox démarre avec ta session, sans fenêtre, avec une icône dans la **zone de notification** (en bas à droite, éventuellement derrière la flèche « ^ »). Clic sur l'icône : ouvrir ; clic droit : **Ouvrir ToolBox** / **Quitter ToolBox**.
- Tant que l'option est active, fermer la fenêtre la **réduit dans la zone de notification** (une notification le rappelle la première fois) : les rappels du Planning de sortie et les envois YouTube en file d'attente continuent.
- Les notifications de ToolBox suivent les réglages de Windows (Paramètres › Système › Notifications) : vérifie que ToolBox y est autorisé.
- L'inscription au démarrage ne concerne que l'app installée (`ToolBox-Setup`), pas la version portable déplacée ailleurs.

## Barre de commande écrite : le clavier

La barre écrite de l'assistant (Réglages › Assistant vocal, touche « barre écrite », désactivée par défaut) s'ouvre par-dessus l'application en cours et doit recevoir le clavier tout de suite. Windows protège le premier plan ; ToolBox le demande par étapes (ADR 0039) : focus direct, puis, seulement si besoin, un appui sur Alt simulé autour de la demande. S'il n'y arrive pas, la barre devient orange et dit « Clique dans le champ pour écrire » : les touches ne partent jamais en silence au mauvais endroit.

À tester (la barre activée, sur une touche en double appui) :

1. Ouvrir le Bloc-notes, cliquer dedans, taper deux fois la touche : la barre s'ouvre, **le texte tapé va dans la barre** (pas dans le Bloc-notes).
2. Même chose avec FL Studio au premier plan, en lecture : idem, et la lecture continue.
3. Même chose avec ToolBox réduit dans la zone de notification : idem.
4. Écrire « liste de courses », Entrée : la réponse s'affiche ; Échap : la barre se ferme et le clavier revient au Bloc-notes (taper : le texte va dans le Bloc-notes).
5. Si la barre devient orange (« Clique dans le champ… ») : cliquer dans le champ, taper : le texte va dans la barre. Le noter (dans quelle application c'était) : c'est le cas où Windows a refusé.
6. Vérifier que le Bloc-notes n'a pas sa barre de menus sélectionnée après la fermeture de la barre (effet possible de l'Alt simulé ; Échap la libère).
