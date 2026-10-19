# Moteur vidéo (`video-engine`)

Moteur de rendu **unique** partagé par les générateurs (YouTube, Instagram) : toute amélioration visuelle profite à tous. Module de service, sans page : les rendus apparaissent dans la page **Tâches** via les modules qui l'utilisent.

## Style visuel (V1)

- Fond : un dégradé doux aux couleurs de la cover (la cover entière réduite à une grille de couleurs moyennes, agrandie et floutée : pas de taches), assombri sur les bords et nettement vers le bas pour la lisibilité des barres.
- Au centre : la cover nette, coins arrondis, ombre portée, **zoom lent** sur toute la durée.
- Barres de spectre audio-réactives (`showcqt`, échelle de fréquences logarithmique de 45 Hz à 8 kHz), blanches semi-transparentes. Sur la branche de visualisation seulement, les aigus sont relevés de +4 dB/octave (max +15 dB) et l'amplitude est compressée : le mouvement se répartit sur toute la largeur au lieu de rester dans les graves.
- Titre et artiste (artiste en capitales, blanc opaque, ombre marquée) en Montserrat SemiBold (police embarquée, licence OFL : `assets/fonts/OFL.txt`).
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
3. **La bande-son** (`soundtrack.m4a`) : extrait, fondus, limiteur de crête sur un signal suréchantillonné ×4 (plafond -1,5 dBFS, sans gain de compensation), encodage AAC. Le **true peak de l'AAC encodé est mesuré** (`ebur128`) : s'il dépasse **-1 dBTP**, le plafond est abaissé d'autant et le son ré-encodé (4 essais au plus ; sinon le rendu échoue avec un message clair). Les aperçus font une seule passe.
4. Le rendu principal (`buildRenderArgs`) : graphe FFmpeg sans aucun chemin absolu (FFmpeg tourne dans le dossier de travail), progression réelle via `-progress`, annulation (le process est tué, le fichier partiel supprimé). La bande-son vérifiée y est **copiée** (`-c:a copy`), jamais ré-encodée.

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
