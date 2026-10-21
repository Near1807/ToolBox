# Reels depuis mes vidéos (`custom-reels`)

Des Reels Instagram 9:16 faits avec **tes propres vidéos**, sur un extrait du morceau, avec un effet au choix. Même logique et mêmes composants que le Pack Insta (vignette à glisser, Régénérer, Supprimer, légende modifiable, case « Publié »). Le son est **toujours et seulement** l'extrait du morceau.

## Ce qu'il fait

1. **Tes vidéos** : glisse une ou plusieurs vidéos (MP4, MOV, M4V, WEBM, MKV, AVI) sur la page, ou « Ajouter des vidéos ». Elles sont **copiées** dans ToolBox (comme les sons de la Bibliothèque) : déplacer les originaux ne casse rien. « Retirer » efface la copie (pas l'original), refusé tant qu'un Reel l'utilise.
2. **Créer 1 à 4 Reels** (1 par défaut) : chacun reçoit un extrait (28 s par défaut, réglable de 15 à 60 s Reel par Reel) sur un passage fort du morceau, et une vidéo (les vidéos à tour de rôle). « Ajouter un Reel » jusqu'à 4.
3. **Extraits** : sur la même forme d'onde que le Pack Insta (glisser un extrait, cliquer pour le placer, « Écouter »).
4. Pour chaque Reel :
   - **Effet** (un par Reel) : Brut, Calme, Rythme, Ciné, avec **« Aperçu (4 s) »** en basse résolution. Détail des effets : [`docs/DIRECTION-ARTISTIQUE.md`](../../docs/DIRECTION-ARTISTIQUE.md) (« Reels depuis mes vidéos »).
   - **Cadrage 9:16, sans recadrage automatique** : par défaut la vidéo entière sur un fond flou fait avec la vidéo elle-même ; option « Remplir l'écran » avec un **point de cadrage** choisi en cliquant sur l'image.
   - **Vidéo** : un passage choisi sur une timeline (images de la vidéo, début et fin, aperçu muet du passage), ou plusieurs passages enchaînés en coupe franche. Si la vidéo est plus courte que l'extrait, l'écran le dit : elle sera **bouclée** (relancée au début).
   - Fichier : carte partagée (vignette à glisser vers Instagram, Lire, Dossier, Générer / Régénérer, Supprimer), **légende** modifiable sur place (modèle des réglages, « Enregistrer comme modèle par défaut »), case **« Publié »** avec la date.
5. **« Lancer le rendu »** : rend tout ce qui est nouveau, modifié (« À régénérer »), en échec ou introuvable. Une tâche par Reel (progression et annulation dans Tâches).

Rendu : 1080×1920, pixels carrés, 30 i/s, titre et artiste discrets, fondus de 0,5 s, son limité à -1 dBTP, zones de sécurité Instagram (moteur vidéo, `renderVideoReel`). Fichiers dans `<dossier de sortie>/custom-reels/<Artiste - Titre>/<titre> - Reel perso N.mp4`.

Chaque Reel est enregistré dans `ctx.outputs` (ref `reel:<id>`, **projet** = le morceau, `music-library:track:<id>`) : il apparaît dans la vue projet de la Bibliothèque (« Reels perso », avec son état et « Inclure dans la sortie ») et dans « Fichiers générés ». Le Planning de sortie peut l'ajouter comme Reel Instagram et/ou Short YouTube (service `customReels`).

## Données

| Élément        | Détail                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables         | `custom_reels__sources` (vidéos importées : morceau, copie, nom, durée, taille) · `custom_reels__reels` (extrait, passages JSON, cadrage, point, effet, légende propre, fichier, miniature, paramètres du dernier rendu, publication) — migration 1 |
| Fichiers       | copies des vidéos `<userData>/modules/custom-reels/videos/` · images de timeline `filmstrips/` · miniatures `thumbnails/` · Reels dans le dossier de sortie                                                                                         |
| Réglages       | `clipDuration` (15–60, 28), `defaultEffect` (`raw`), `captionTemplate` (`{titre}`, `{artiste}`, `{hashtags}`), `hashtags`                                                                                                                           |
| Tâche          | `render` `{ reelId }`                                                                                                                                                                                                                               |
| Événement émis | `custom-reels:video.created` `{ trackId, file }`                                                                                                                                                                                                    |
| Service fourni | `customReels` ([`contract.ts`](contract.ts)) : `listReels(trackId)`, `getReel(id)`, `setPublished(id, publié)`, `setCaption(id, légende \| null)`, `renderReel(id)`                                                                                 |
| Bibliothèque   | état « Publié » (`registerProjectStatus`) et ligne « Reels perso : x/n publiés » (`registerTrackInfo`)                                                                                                                                              |

## Dépendances

Modules `music-library` et `video-engine` ; services `musicLibrary` et `videoEngine` (`renderVideoReel`, `previewVideoReel`, `probeVideo`, `filmstrip`, `waveform`, `videoEffects`).

## API

| Méthode | Route                                      | Rôle                                                                                                              |
| ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GET     | `/effects`                                 | Banque d'effets                                                                                                   |
| GET     | `/tracks` · `/tracks/:id`                  | Morceaux (avec état des Reels) · morceau, vidéos, Reels                                                           |
| GET     | `/tracks/:id/waveform`                     | Forme d'onde du morceau                                                                                           |
| POST    | `/tracks/:id/sources`                      | Importe `{ paths }` (copie)                                                                                       |
| DELETE  | `/sources/:id`                             | Retire une vidéo (sa copie)                                                                                       |
| GET     | `/sources/:id/filmstrip`                   | Images de la timeline                                                                                             |
| POST    | `/tracks/:id/reels`                        | Crée `{ count }` Reels (1 à 4 au total)                                                                           |
| PATCH   | `/reels/:id`                               | `{ startSec?, durationSec?, segments?, framing?, focusX?, focusY?, effect?, caption?, published?, publishedAt? }` |
| POST    | `/reels/:id/preview`                       | Aperçu de 4 s                                                                                                     |
| POST    | `/reels/:id/render` · `/tracks/:id/render` | Rendu d'un Reel · de tout ce qui est à faire                                                                      |
| POST    | `/reels/:id/caption/template`              | Légende → modèle par défaut                                                                                       |
| POST    | `/reels/:id/open` · `/reels/:id/reveal`    | Ouvre le fichier / le montre                                                                                      |
| DELETE  | `/reels/:id`                               | Supprime le Reel (fichier à la Corbeille)                                                                         |
| GET     | `/to-publish`                              | Reels rendus non publiés                                                                                          |
