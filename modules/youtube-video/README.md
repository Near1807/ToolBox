# Vidéo YouTube (`youtube-video`)

Transforme un morceau de la Bibliothèque en vidéo **16:9 (1920×1080) du morceau entier**, avec le style du moteur vidéo, et prépare le titre et la description à copier dans YouTube.

## Ce qu'il fait

- Choix du morceau (liste de la Bibliothèque), **aperçu** de 6 s en basse résolution, puis **« Générer la vidéo »** : rendu en tâche de fond (progression, annulation, visible aussi dans la page Tâches).
- La vidéo est écrite dans `<dossier de sortie>/youtube-video/Artiste - Titre (YouTube).mp4` (jamais d'écrasement : « (2) », « (3) »…), et apparaît aussi sur la fiche du morceau dans la Bibliothèque.
- **Titre** (« Artiste - Titre ») et **description** prêts à copier : date de sortie, liens (réglage), hashtags (tags du morceau + hashtags par défaut).
- Boutons « Lire », « Ouvrir le dossier ».
- **Publication directe sur YouTube : préparée, pas encore active** (bouton grisé). Voir `backend/upload.ts` pour la marche à suivre ; la table `youtube_video__videos` a déjà les colonnes `youtube_video_id` et `uploaded_at`.

## Données

| Élément        | Détail                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Table          | `youtube_video__videos` (morceau, fichier, titre, date ; colonnes prêtes pour l'upload) — migration 1 |
| Fichiers       | vidéos dans `<dossier de sortie>/youtube-video/`                                                      |
| Réglages       | `links` (texte), `hashtags`                                                                           |
| Tâche          | `render` `{ trackId }`                                                                                |
| Événement émis | `youtube-video:video.created` `{ trackId, file }`                                                     |

## Dépendances

Modules `music-library` et `video-engine` ; services `musicLibrary` et `videoEngine` (types importés de leurs `contract.ts`).

## API

| Méthode | Route                                     | Rôle                                                |
| ------- | ----------------------------------------- | --------------------------------------------------- |
| GET     | `/tracks`                                 | Morceaux disponibles                                |
| GET     | `/tracks/:id`                             | Morceau, titre et description, vidéos déjà générées |
| POST    | `/tracks/:id/preview`                     | Aperçu (renvoie une URL de lecture)                 |
| POST    | `/tracks/:id/render`                      | Lance le rendu (renvoie la tâche)                   |
| POST    | `/videos/:id/open` · `/videos/:id/reveal` | Lit la vidéo / la montre dans l'Explorateur         |
| POST    | `/open-output-folder`                     | Ouvre le dossier des vidéos                         |
