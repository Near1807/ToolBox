# Reel Instagram (`instagram-video`)

Un **extrait vertical 9:16 (1080×1920)** d'un morceau de la Bibliothèque, au style du moteur vidéo, pour Instagram (Reels). **La même vidéo sert de YouTube Short.**

## Ce qu'il fait

- Choix du morceau, puis de l'extrait : **durée** de 15 à 90 s (30 s par défaut, réglable), **point de départ** en cliquant sur la forme d'onde.
- **« Suggérer un passage »** : trouve la section la plus énergique (somme des niveaux RMS au carré sur la durée choisie). À l'ouverture, l'extrait suggéré est présélectionné.
- « Écouter l'extrait », **aperçu** de 6 s en basse résolution, puis **« Générer le Reel »** (tâche de fond : progression, annulation).
- Vidéo écrite dans `<dossier de sortie>/instagram-video/Artiste - Titre (Reel).mp4` et listée sur la fiche du morceau.
- **Légende** prête à copier : « Titre — Artiste », phrase d'appel (réglage), hashtags (tags du morceau + hashtags par défaut).

## Données

| Élément        | Détail                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table          | `instagram_video__reels` (morceau, fichier, début, durée, date) — migration 1                                                                            |
| Fichiers       | Reels dans `<dossier de sortie>/instagram-video/` · cache d'analyse `<userData>/modules/instagram-video/analysis/<id>.json` (recalculé si le son change) |
| Réglages       | `defaultDuration` (15–90), `callToAction`, `hashtags`                                                                                                    |
| Tâche          | `render` `{ trackId, start, duration }`                                                                                                                  |
| Événement émis | `instagram-video:video.created` `{ trackId, file }`                                                                                                      |

L'analyse décode le son en mono 8 kHz avec FFmpeg (pics et RMS par fenêtre de 0,1 s) ; les fonctions de calcul sont pures et testées (`backend/analysis.ts`).

## Dépendances

Modules `music-library` et `video-engine` ; services `musicLibrary` et `videoEngine`.

## API

| Méthode | Route                                   | Rôle                                                               |
| ------- | --------------------------------------- | ------------------------------------------------------------------ |
| GET     | `/tracks`                               | Morceaux disponibles                                               |
| GET     | `/tracks/:id`                           | Morceau, URL du son, durée par défaut, légende, Reels déjà générés |
| GET     | `/tracks/:id/waveform`                  | Forme d'onde (400 barres) et départ suggéré                        |
| POST    | `/tracks/:id/suggest`                   | Passage le plus énergique pour `{ duration }`                      |
| POST    | `/tracks/:id/preview`                   | Aperçu de `{ start }`                                              |
| POST    | `/tracks/:id/render`                    | Lance le rendu de `{ start, duration }`                            |
| POST    | `/reels/:id/open` · `/reels/:id/reveal` | Lit le Reel / le montre dans l'Explorateur                         |
| POST    | `/open-output-folder`                   | Ouvre le dossier des Reels                                         |
