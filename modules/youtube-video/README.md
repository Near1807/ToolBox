# Vidéo YouTube (`youtube-video`)

Transforme un morceau de la Bibliothèque en vidéo **16:9 (1920×1080) du morceau entier**, avec le style du moteur vidéo, et prépare le titre et la description à copier dans YouTube.

## Ce qu'il fait

- Choix du morceau (liste de la Bibliothèque), **aperçu** de 6 s en basse résolution, puis **« Générer la vidéo »** : rendu en tâche de fond (progression, annulation, visible aussi dans la page Tâches).
- La vidéo est écrite dans `<dossier de sortie>/youtube-video/Artiste - Titre (YouTube).mp4` (jamais d'écrasement : « (2) », « (3) »…), et apparaît aussi sur la fiche du morceau dans la Bibliothèque.
- **Titre, description et tags modifiables sous la vidéo** (composant partagé `TextFields`), avec compteur (100 caractères, 5000 octets) et « Copier ». Ils sont **pré-remplis** par les modèles des réglages (par défaut : « Artiste - Titre » ; date de sortie, liens, hashtags = tags du morceau + hashtags par défaut) : un texte modifié reste tel quel (« Personnalisé »), « Rétablir le modèle » y revient, **« Enregistrer comme modèle par défaut »** fait du texte le modèle des autres morceaux (titre, artiste… remplacés par leurs repères). Le Planning de sortie envoie ces textes.
- Boutons « Lire », « Ouvrir le dossier », **« Supprimer »** (avec confirmation : le fichier part dans la Corbeille, la vidéo disparaît de ToolBox) ; **sélection multiple** pour supprimer plusieurs vidéos d'un coup.
- Fichier supprimé ou déplacé dans l'Explorateur : la vidéo s'affiche **« Fichier introuvable »** avec « Retirer de la liste » ou « Régénérer », et « Nettoyer les éléments introuvables » pour toutes. Chaque vidéo est enregistrée dans `ctx.outputs` (ref `video:<id>`, sujet `music-library:track:<id>`) ; celles d'avant la v0.7 le sont au démarrage.
- **Publication sur YouTube** : faite par le module **Planning de sortie** (envoi et programmation à l'avance). Une vidéo envoyée affiche ici « Sur YouTube ↗ » (colonnes `youtube_video_id`, `uploaded_at`).

## Données

| Élément        | Détail                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables         | `youtube_video__videos` (morceau, fichier, titre, date ; colonnes prêtes pour l'upload) — migration 1 · `youtube_video__texts` (textes modifiés par morceau, `null` = texte du modèle) — migration 2                                              |
| Fichiers       | vidéos dans `<dossier de sortie>/youtube-video/`, enregistrées dans `ctx.outputs` (supprimer une vidéo efface aussi sa ligne)                                                                                                                     |
| Réglages       | `titleTemplate`, `descriptionTemplate` (repères `{titre}`, `{artiste}`, `{titre_youtube}`, `{sortie}`, `{liens}`, `{hashtags}` ; vides = format intégré), `links` (texte), `hashtags`                                                             |
| Tâche          | `render` `{ trackId }`                                                                                                                                                                                                                            |
| Événement émis | `youtube-video:video.created` `{ trackId, file }`                                                                                                                                                                                                 |
| Service fourni | `youtubeVideo` (types dans [`contract.ts`](contract.ts)) : `listVideos(trackId)`, `getVideo(id)`, `texts(trackId)` (titre, description, tags, `custom`), `setTexts(trackId, modif \| null)`, `render(trackId)`, `setUploaded(videoId, youtubeId)` |

## Dépendances

Modules `music-library` et `video-engine` ; services `musicLibrary` et `videoEngine` (types importés de leurs `contract.ts`).

## API

| Méthode | Route                                     | Rôle                                                |
| ------- | ----------------------------------------- | --------------------------------------------------- |
| GET     | `/tracks`                                 | Morceaux disponibles                                |
| GET     | `/tracks/:id`                             | Morceau, titre et description, vidéos déjà générées |
| PATCH   | `/tracks/:id/texts`                       | `{ videoTitle?, description?, tags? }` modifiés     |
| DELETE  | `/tracks/:id/texts`                       | Retour aux textes du modèle                         |
| POST    | `/tracks/:id/texts/template`              | « Enregistrer comme modèle par défaut »             |
| POST    | `/tracks/:id/preview`                     | Aperçu (renvoie une URL de lecture)                 |
| POST    | `/tracks/:id/render`                      | Lance le rendu (renvoie la tâche)                   |
| POST    | `/videos/:id/open` · `/videos/:id/reveal` | Lit la vidéo / la montre dans l'Explorateur         |
| POST    | `/open-output-folder`                     | Ouvre le dossier des vidéos                         |
