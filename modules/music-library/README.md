# Bibliothèque (`music-library`)

Base commune de la section Musique : tes morceaux (son, cover, infos), utilisés par les générateurs de vidéos.

## Ce qu'il fait

- Ajout d'un morceau par **glisser-déposer** (un son WAV/MP3/FLAC et sa cover JPG/PNG, n'importe où sur la page) ou par le bouton « Ajouter un morceau ».
- Les fichiers sont **copiés** dans ToolBox : déplacer ou supprimer l'original ne casse rien.
- Lecture des métadonnées avec ffprobe (durée, format, fréquence, canaux, titre et artiste s'ils sont dans le fichier).
- Grille avec recherche, **mini-lecteur**, page de détail : édition (titre, artiste, date de sortie, tags, notes), changement de cover, lecteur, **vidéos générées** (lire, afficher dans le dossier), suppression.
- Artiste par défaut réglable, utilisé quand un morceau n'a pas d'artiste.

## Données

| Élément         | Détail                                                                                                                                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables          | `music_library__tracks` (métadonnées, chemins relatifs des fichiers) · `music_library__outputs` (fichiers générés depuis un morceau) — migration 1                                                                                                                                                                         |
| Fichiers        | `<userData>/modules/music-library/tracks/<id>/audio.<ext>` et `cover-<horodatage>.<ext>`                                                                                                                                                                                                                                   |
| Réglages        | `defaultArtist`                                                                                                                                                                                                                                                                                                            |
| Événements émis | `music-library:track.created`, `music-library:track.updated`, `music-library:track.deleted` — `{ id }`                                                                                                                                                                                                                     |
| Service fourni  | `musicLibrary` (types dans [`contract.ts`](contract.ts)) : `listTracks()`, `getTrack(id)`, `recordOutput(trackId, { moduleId, kind, label, filePath })`, `listOutputs(trackId)`, `registerTrackInfo({ moduleId, label, get(trackId) })` (ligne d'information affichée sur la fiche du morceau, ex. état du pack Instagram) |

La fiche d'un morceau liste **ses fichiers générés par tous les modules** (vidéos YouTube, Reels, post), lus dans `ctx.outputs` par le sujet `music-library:track:<id>`, avec Ouvrir, Supprimer, sélection multiple et fichiers introuvables. `recordOutput` / `listOutputs` restent dans le service pour compatibilité mais sont dépréciés (la table `music_library__outputs` est conservée telle quelle).

Supprimer un morceau efface les copies de son et de cover (les fichiers d'origine ne sont jamais touchés) et **propose de supprimer aussi ses fichiers générés** (case cochée par défaut : ils partent dans la Corbeille, chaque module nettoie ses données).

## Dépendances

Aucune.

## API

| Méthode | Route                                       | Rôle                                                            |
| ------- | ------------------------------------------- | --------------------------------------------------------------- |
| GET     | `/tracks`                                   | Liste (avec URL de lecture et de cover)                         |
| GET     | `/tracks/:id`                               | Détail + fichiers générés                                       |
| POST    | `/tracks`                                   | Ajoute `{ audioPath, coverPath? }` (chemins locaux)             |
| PATCH   | `/tracks/:id`                               | Modifie `{ title?, artist?, releaseDate?, notes?, tags? }`      |
| PUT     | `/tracks/:id/cover`                         | Remplace la cover `{ path }`                                    |
| DELETE  | `/tracks/:id` (`?outputs=1`)                | Supprime le morceau (et ses fichiers générés avec `?outputs=1`) |
| POST    | `/outputs/:id/open` · `/outputs/:id/reveal` | Ouvre un fichier généré / le montre dans l'Explorateur          |
| GET     | `/summary`                                  | Nombre de morceaux, durée totale, artiste par défaut            |
