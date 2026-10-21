# Moteur vidéo (`video-engine`)

Moteur de rendu **unique** partagé par les générateurs (YouTube, Instagram) : toute amélioration visuelle profite à tous. Module de service, sans page : les rendus apparaissent dans la page **Tâches** via les modules qui l'utilisent.

Tout le rendu suit la charte [`docs/DIRECTION-ARTISTIQUE.md`](../../docs/DIRECTION-ARTISTIQUE.md) : sobre, cover toujours entière, seuls mouvements lents de l'image entière, couleurs issues de la cover. YouTube et Reels partagent le même style (fond, carte de la cover, texte) ; YouTube est rendu par un graphe FFmpeg (`buildRenderArgs`), les Reels **image par image** sur un canvas (voir « Reels » ci-dessous et `docs/decisions/0017-rendu-image-par-image.md`).

## Style

- **Fond** : la cover elle-même, agrandie juste assez pour remplir l'image, puis **très floutée** (réduite à 1/16, floutée, ré-agrandie : uniforme, sans taches), adoucie (saturation et contraste réduits), assombrie sur les bords et nettement vers le bas pour la lisibilité de la visualisation.
- **Cover** : entière, ratio d'origine (inscrite dans sa boîte, jamais étirée ni recadrée), coins arrondis, ombre douce, **zoom lent** sur toute la durée (5 % YouTube, 2 % Reels).
- **Titre et artiste** sous la cover, centrés : titre, puis artiste en capitales espacées, blanc, ombre légère, Montserrat SemiBold (police embarquée, licence OFL : `assets/fonts/OFL.txt`).
- **Visualisation YouTube** : barres de spectre (`showcqt`, échelle logarithmique de 45 Hz à 8 kHz) réparties sur toute la largeur, blanches semi-transparentes. Sur la seule branche de visualisation, les aigus sont relevés de +3 dB/octave (max +12 dB), l'amplitude est compressée et le mouvement est lissé sur 3 images : discrète, elle accompagne sans clignoter.
- Léger grain, **fondus** d'entrée et de sortie (image et son) : 1,5 s / 2 s par défaut, `fadeSeconds` pour les Reels (0,5 s).
- **Proportions** : toutes les chaînes de filtres finissent par `setsar=1` (pixels carrés : la vidéo s'affiche exactement en 1920×1080 ou 1080×1920 partout). Vérifié par un test ffprobe (`SAR 1:1`, DAR 16:9 / 9:16).

| Format            | Mise en page                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube 1920×1080 | cover 560 px au centre-haut, titre et artiste dessous, visualisation 1400 px en bas                                                                                                                                                                                             |
| Reel 1080×1920    | cover dans une boîte de 660 px centrée (y 800), barres sur son contour, titre (haut à y 1236) et artiste (y 1314) dessous. Tout reste hors des zones Instagram (350 px en bas, 150 px à droite, 220 px en haut), même zoomé, en pleine respiration et barres au maximum (testé) |

## Reels : rendu image par image

Les Reels sont dessinés image par image (`renderReel`, `backend/reel-frames.ts`) sur un canvas Skia (`@napi-rs/canvas`) puis envoyés en RGBA brut à FFmpeg, qui ajoute grain, fondus et `setsar=1` et copie la bande-son vérifiée.

- **Respiration pilotée par le son** (`backend/audio-analysis.ts`) :
  1. Énergie des basses (40–150 Hz : deux passe-haut et deux passe-bas de Butterworth), puissance moyenne sur 25 ms, à la milliseconde.
  2. Valeur par image : le maximum de la tranche [t, t + 1/30 s). La crête d'un coup de basse est rattachée à l'image où il commence : un coup qui tombe en fin d'image a sa crête dans l'image suivante.
  3. Normalisation sur l'extrait (plancher = 30e centile, plafond = 98e centile, au moins une référence fixe : un extrait sans basses marquées reste presque immobile), courbe ^1,5.
  4. Enveloppe à **attaque instantanée** (le maximum est sur l'image du coup, jamais après) et retour exponentiel de 160 ms.
  5. Échelle = (1 + 2 % × avancement) × (1 + **1,8 %** × enveloppe).
- **Visualisation sur le contour** : ~190 fines barres (3 px, espacées de 14 px) le long du rectangle arrondi, vers l'extérieur, à 8 px du bord.
  - Basses en bas, aigus en haut, en miroir gauche/droite.
  - Longueur jusqu'à 5 % de la largeur de la cover selon le spectre de l'image : FFT de 2048 points centrée sur l'image, 24 bandes logarithmiques de 50 Hz à 8 kHz, aigus relevés de +3 dB/octave, 36 dB de dynamique, montée rapide et descente lente.
  - Teinte claire tirée de la cover (couleur moyenne mêlée de 60 % de blanc), opacité 0,55. Les barres suivent la respiration.
- **Préparé une fois** : fond flouté avec titre et artiste, carte de la cover (×1,5 pour un dessin net à toutes les échelles).
- **Temps de rendu** d'un Reel de 28 s (840 images, 1080×1920) : 29 à 33 s sur 4 cœurs (Xeon 2,1 GHz). Dessin et encodage tournent en parallèle.

### Mesure de synchronisation

Pour chaque attaque de basse, on mesure l'écart entre l'attaque et l'image où l'échelle de la cover est maximale ; une image dure 33 ms. On compte aussi la part d'images quasi immobiles (enveloppe < 0,05, soit < 0,1 % d'échelle).

- **Coups connus** : morceaux de synthèse dont on connaît les instants des coups.
- **Coups détectés** : vrais morceaux, attaques repérées sur les basses.
- **Pics visibles** : coups qui font monter l'enveloppe d'au moins 0,1. Un coup faible au milieu d'un passage chargé peut ne rien faire bouger, ce qui est voulu.

| Extrait                                        | Attaques     | Pics visibles | Écart attaque → maximum | Images quasi immobiles |
| ---------------------------------------------- | ------------ | ------------- | ----------------------- | ---------------------- |
| 48 coups irréguliers + passage calme (10–15 s) | 48 connues   | 48            | −33 à +2 ms             | 27 %                   |
| coups réguliers toutes les 0,5 s               | 55 connues   | 55            | 0 ms                    | —                      |
| coups réguliers, master très fort (saturé)     | 55 connues   | 55            | 0 ms                    | —                      |
| vrai morceau électro, extrait à 0 s            | 75 détectées | 47            | −29 à +4 ms             | 45 %                   |
| même morceau, extrait à 10 s                   | 88 détectées | 41            | −29 à +10 ms            | 43 %                   |
| même morceau, extrait à 33 s                   | 79 détectées | 39            | −27 à +10 ms            | 40 %                   |
| vrai morceau batterie acoustique (25 s)        | 44 détectées | 17            | −29 à +1 ms             | 70 %                   |

Aucun écart ne dépasse une image. Les écarts négatifs viennent de la règle de la tranche : un coup qui tombe dans les dernières millisecondes d'une image fait grossir la cover dès cette image. Un test automatique (`tests/audio-analysis.test.ts`) vérifie la même chose sur des coups de synthèse irréguliers, un passage calme et un extrait sans basses.

## Reels depuis les vidéos de l'utilisateur

`renderVideoReel()` (et `previewVideoReel()`, 4 s en basse résolution) fait un Reel 1080×1920 avec les vidéos de l'utilisateur, pour le module `custom-reels` (`backend/video-reel.ts`) :

1. **Timeline** (`planTimeline`) : les passages choisis, enchaînés en coupe franche ; si la vidéo est plus courte que l'extrait, elle repart au début (le module le signale avant le rendu).
2. **Décodage et cadrage par FFmpeg** (`buildVideoDecodeArgs`), en RGB brut à 30 i/s : « vidéo entière » (la vidéo inscrite dans le 9:16, jamais coupée, sur un fond fait d'elle-même : réduite au quart, floutée, assombrie, ré-agrandie) ou « remplir » (agrandie juste assez puis recadrée autour du point choisi par l'utilisateur, jamais étirée). L'étalonnage fixe de l'effet est appliqué ici. Le son des vidéos n'est jamais lu.
3. **Mouvement image par image** en JS (`applyMotion`) : zoom bilinéaire autour du centre et flash en mode « écran », seulement quand l'effet en demande (sinon l'image passe telle quelle). L'enveloppe des basses est celle des Reels de cover (`bassEnergyPerFrame` + `breathEnvelope`, attaque instantanée).
4. **Encodage** (`buildFramesEncodeArgs` avec `overlay`) : la couche fixe (bandes et vignette de l'effet, titre et artiste discrets) est posée par FFmpeg, puis grain de l'effet, fondus de 0,5 s, `setsar=1` ; la bande-son est l'extrait du morceau, limitée et vérifiée à -1 dBTP (même code que les autres rendus).

**Banque d'effets** : un fichier par effet dans `backend/effects/` (Brut, Calme, Rythme, Ciné), décrits dans `docs/DIRECTION-ARTISTIQUE.md`. Chaque effet déclare son étalonnage FFmpeg, son grain, son mouvement par image (zoom, flash) en fonction de l'avancement et de l'enveloppe des basses, et sa couche fixe éventuelle.

Temps de rendu mesuré (8 s, 1080×1920, 4 cœurs Xeon 2,1 GHz) : Brut 13 s, Ciné 20 s, Rythme 27 s, Calme 33 s (le zoom image par image coûte ~70 ms par image).

Outils pour l'éditeur du module : `probeVideo()` (durée, taille affichée — rotation des vidéos de téléphone appliquée), `filmstrip()` (images réparties sur la vidéo, pour la timeline), `waveform()` (forme d'onde d'un morceau).

## Miniature YouTube (16:9)

`renderThumbnail()` compose une image **1280×720** (JPEG haute qualité, bien sous la limite de 2 Mo de YouTube) : même fond flouté, cover entière arrondie avec ombre (boîte de 400 px), titre plus grand (vu en petit) et artiste. Pas de spectre. Utilisée par le Planning de sortie pour la vidéo longue.

## Post image (4:5)

`renderPost()` compose une image **1080×1350** (JPEG haute qualité) : même fond, cover entière arrondie avec ombre (700 px), titre, artiste. Rien d'autre.

## Formats

| Format      | Taille            | Vidéo                                 | Audio                  |
| ----------- | ----------------- | ------------------------------------- | ---------------------- |
| `youtube`   | 1920×1080, 30 i/s | H.264 High, 8 Mbit/s (max 10), GOP 15 | AAC 384 kbit/s, 48 kHz |
| `instagram` | 1080×1920, 30 i/s | H.264 High, 6 Mbit/s (max 8)          | AAC 256 kbit/s, 48 kHz |

Aperçu : quelques secondes à un tiers de la résolution, encodage rapide, sans fondus (Reels : même dessin, mis à l'échelle).

## Fonctionnement

1. Deux images préparées une fois par rendu : `background.png` (fond) et `card.png` (cover arrondie + ombre).
2. YouTube : un fichier `text.ass` (titre, artiste) rendu par libass, avec un `fonts.conf` limité à la police embarquée. Reels : texte dessiné sur le canvas avec la même police.
3. **La bande-son** (`soundtrack.m4a`) : extrait, fondus, limiteur de crête sur un signal suréchantillonné ×4 (plafond -1,5 dBFS, sans gain de compensation), encodage AAC (codeur « fast » : le codeur par défaut ajoutait jusqu'à +5 dB de dépassement sur les masters très forts). Le **true peak de l'AAC encodé est mesuré** (`ebur128`) : s'il dépasse **-1,1 dBTP** (marge de 0,1 dB : ebur128 n'affiche qu'une décimale), le plafond est abaissé d'autant et le son ré-encodé (4 essais au plus ; sinon le rendu échoue avec un message clair). Les aperçus font une seule passe.
4. Le rendu principal (YouTube : `buildRenderArgs` ; Reels : `buildFramesEncodeArgs`, images reçues sur l'entrée standard) : graphe FFmpeg sans aucun chemin absolu (FFmpeg tourne dans le dossier de travail), progression réelle via `-progress`, annulation (le process est tué, le fichier partiel supprimé). La bande-son vérifiée y est **copiée** (`-c:a copy`), jamais ré-encodée.

Toutes les commandes sont construites par des **fonctions pures** (`backend/commands.ts`), testées sans FFmpeg ; des tests lancent aussi de vrais rendus courts.

Les rendus complets passent **un par un** (file d'attente interne : « En attente du moteur… ») ; les aperçus passent directement.

## Données

| Élément        | Détail                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables         | aucune                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Fichiers       | `<userData>/modules/video-engine/work/` (temporaire, vidé au démarrage) · `previews/` (6 derniers aperçus)                                                                                                                                                                                                                                                                                                                          |
| Assets         | `assets/fonts/Montserrat-SemiBold.ttf` (libass et canvas)                                                                                                                                                                                                                                                                                                                                                                           |
| Service fourni | `videoEngine` (types dans [`contract.ts`](contract.ts)) : `formats`, `render(request, { signal, onProgress })`, `preview(request)`, `renderPost(request)`, `renderThumbnail(request)` (miniature YouTube 1280×720, même style, sans spectre), `probeDuration(audioPath)`, `videoEffects`, `renderVideoReel(request)`, `previewVideoReel(request)`, `probeVideo(path)`, `filmstrip(path, n, dossier)`, `waveform(audioPath, barres)` |

## Dépendances

Aucun module (utilise `ctx.binaries.ffmpeg` / `ffprobe`). Paquet natif `@napi-rs/canvas` (Skia, N-API, précompilé ; vérifié par `npm run check:native` et le smoke test). Compatible FFmpeg 6.1 (Windows).
