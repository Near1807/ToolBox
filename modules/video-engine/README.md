# Moteur vidéo (`video-engine`)

Moteur de rendu **unique** partagé par les générateurs (YouTube, Instagram) : toute amélioration visuelle profite à tous. Module de service, sans page : les rendus apparaissent dans la page **Tâches** via les modules qui l'utilisent.

Tout le rendu suit la charte [`docs/DIRECTION-ARTISTIQUE.md`](../../docs/DIRECTION-ARTISTIQUE.md) : sobre, cover toujours entière, seuls mouvements lents de l'image entière, couleurs issues de la cover. YouTube et Reels utilisent **le même pipeline** (`buildRenderArgs`), décliné en 16:9 et 9:16.

## Style

- **Fond** : la cover elle-même, agrandie juste assez pour remplir l'image, puis **très floutée** (réduite à 1/16, floutée, ré-agrandie : uniforme, sans taches), adoucie (saturation et contraste réduits), assombrie sur les bords et nettement vers le bas pour la lisibilité de la visualisation.
- **Cover** : entière, ratio d'origine (inscrite dans sa boîte, jamais étirée ni recadrée), coins arrondis, ombre douce, **zoom lent** sur toute la durée (5 % YouTube, 3 % Reels).
- **Titre et artiste** sous la cover, centrés : titre, puis artiste en capitales espacées, blanc, ombre légère, Montserrat SemiBold (police embarquée, licence OFL : `assets/fonts/OFL.txt`).
- **Visualisation** : barres de spectre (`showcqt`, échelle logarithmique de 45 Hz à 8 kHz) réparties sur toute la largeur, blanches semi-transparentes. Sur la seule branche de visualisation, les aigus sont relevés de +3 dB/octave (max +12 dB), l'amplitude est compressée et le mouvement est lissé sur 3 images : discrète, elle accompagne sans clignoter.
- Léger grain, **fondus** d'entrée et de sortie (image et son) : 1,5 s / 2 s par défaut, `fadeSeconds` pour les Reels (0,5 s).
- **Reels uniquement — respiration** : la cover entière grossit de 1 à 1,5 % sur les temps forts de l'extrait puis revient doucement (montée en demi-cosinus de 160 ms, retour exponentiel de 0,45 s, plafond 1,5 %). Les temps forts viennent d'une détection d'attaques (énergie du signal et de sa dérivée), `backend/beats.ts`.
- **Proportions** : toutes les chaînes de filtres finissent par `setsar=1` (pixels carrés : la vidéo s'affiche exactement en 1920×1080 ou 1080×1920 partout). Vérifié par un test ffprobe (`SAR 1:1`, DAR 16:9 / 9:16).

| Format            | Mise en page                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube 1920×1080 | cover 560 px au centre-haut, titre et artiste dessous, visualisation 1400 px en bas                                                                                                                |
| Reel 1080×1920    | cover 740 px centrée (y 760), titre (y 1222) et artiste (y 1302) dessous, visualisation fine 744×120 px (y 1396). Tout reste hors des zones Instagram : 350 px en bas, 150 px à droite, même zoomé |

## Post image (4:5)

`renderPost()` compose une image **1080×1350** (JPEG haute qualité) : même fond, cover entière arrondie avec ombre (700 px), titre, artiste. Rien d'autre.

## Formats

| Format      | Taille            | Vidéo                                 | Audio                  |
| ----------- | ----------------- | ------------------------------------- | ---------------------- |
| `youtube`   | 1920×1080, 30 i/s | H.264 High, 8 Mbit/s (max 10), GOP 15 | AAC 384 kbit/s, 48 kHz |
| `instagram` | 1080×1920, 30 i/s | H.264 High, 6 Mbit/s (max 8)          | AAC 256 kbit/s, 48 kHz |

Aperçu : quelques secondes à un tiers de la résolution, encodage rapide, sans fondus.

## Fonctionnement

1. Deux images préparées une fois par rendu : `background.png` (fond) et `card.png` (cover arrondie + ombre).
2. Un fichier `text.ass` (titre, artiste) rendu par libass, avec un `fonts.conf` limité à la police embarquée.
3. **La bande-son** (`soundtrack.m4a`) : extrait, fondus, limiteur de crête sur un signal suréchantillonné ×4 (plafond -1,5 dBFS, sans gain de compensation), encodage AAC (codeur « fast » : le codeur par défaut ajoutait jusqu'à +5 dB de dépassement sur les masters très forts). Le **true peak de l'AAC encodé est mesuré** (`ebur128`) : s'il dépasse **-1,1 dBTP** (marge de 0,1 dB : ebur128 n'affiche qu'une décimale), le plafond est abaissé d'autant et le son ré-encodé (4 essais au plus ; sinon le rendu échoue avec un message clair). Les aperçus font une seule passe.
4. Le rendu principal (`buildRenderArgs`) : graphe FFmpeg sans aucun chemin absolu (FFmpeg tourne dans le dossier de travail), progression réelle via `-progress`, annulation (le process est tué, le fichier partiel supprimé). La bande-son vérifiée y est **copiée** (`-c:a copy`), jamais ré-encodée.

Toutes les commandes sont construites par des **fonctions pures** (`backend/commands.ts`), testées sans FFmpeg ; des tests lancent aussi de vrais rendus courts.

Les rendus complets passent **un par un** (file d'attente interne : « En attente du moteur… ») ; les aperçus passent directement.

## Données

| Élément        | Détail                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables         | aucune                                                                                                                                                                                |
| Fichiers       | `<userData>/modules/video-engine/work/` (temporaire, vidé au démarrage) · `previews/` (6 derniers aperçus)                                                                            |
| Assets         | `assets/fonts/Montserrat-SemiBold.ttf`                                                                                                                                                |
| Service fourni | `videoEngine` (types dans [`contract.ts`](contract.ts)) : `formats`, `render(request, { signal, onProgress })`, `preview(request)`, `renderPost(request)`, `probeDuration(audioPath)` |

## Dépendances

Aucune (utilise `ctx.binaries.ffmpeg` / `ffprobe`). Compatible FFmpeg 6.1 (Windows).
