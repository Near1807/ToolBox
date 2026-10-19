# Moteur vidéo (`video-engine`)

Moteur de rendu **unique** partagé par les générateurs (YouTube, Instagram) : toute amélioration visuelle profite à tous. Module de service, sans page : les rendus apparaissent dans la page **Tâches** via les modules qui l'utilisent.

## Style visuel (V1)

- Fond : la cover agrandie, floutée, assombrie, avec vignettage.
- Au centre : la cover nette, coins arrondis, ombre portée, **zoom lent** sur toute la durée.
- Barres de spectre audio-réactives (`showcqt`), blanches semi-transparentes.
- Titre et artiste en Montserrat SemiBold (police embarquée, licence OFL : `assets/fonts/OFL.txt`).
- Léger grain, fondus d'entrée et de sortie (image et son).

La pulsation de la cover sur les basses n'est pas en V1 (voir `docs/ROADMAP.md`).

## Formats

| Format      | Taille            | Vidéo                                 | Audio                  |
| ----------- | ----------------- | ------------------------------------- | ---------------------- |
| `youtube`   | 1920×1080, 30 i/s | H.264 High, 8 Mbit/s (max 10), GOP 15 | AAC 384 kbit/s, 48 kHz |
| `instagram` | 1080×1920, 30 i/s | H.264 High, 6 Mbit/s (max 8)          | AAC 256 kbit/s, 48 kHz |

Aperçu : quelques secondes à un tiers de la résolution, encodage rapide, sans fondus.

## Fonctionnement

1. Deux images préparées une fois par rendu : `background.png` (fond) et `card.png` (cover arrondie + ombre).
2. Un fichier `text.ass` (titre, artiste) rendu par libass, avec un `fonts.conf` limité à la police embarquée.
3. Le rendu principal (`buildRenderArgs`) : graphe FFmpeg sans aucun chemin absolu (FFmpeg tourne dans le dossier de travail), progression réelle via `-progress`, annulation (le process est tué, le fichier partiel supprimé).

Toutes les commandes sont construites par des **fonctions pures** (`backend/commands.ts`), testées sans FFmpeg ; des tests lancent aussi de vrais rendus courts.

Les rendus complets passent **un par un** (file d'attente interne : « En attente du moteur… ») ; les aperçus passent directement.

## Données

| Élément        | Détail                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables         | aucune                                                                                                                                                         |
| Fichiers       | `<userData>/modules/video-engine/work/` (temporaire, vidé au démarrage) · `previews/` (6 derniers aperçus)                                                     |
| Assets         | `assets/fonts/Montserrat-SemiBold.ttf`                                                                                                                         |
| Service fourni | `videoEngine` (types dans [`contract.ts`](contract.ts)) : `formats`, `render(request, { signal, onProgress })`, `preview(request)`, `probeDuration(audioPath)` |

## Dépendances

Aucune (utilise `ctx.binaries.ffmpeg` / `ffprobe`). Compatible FFmpeg 6.1 (Windows).
