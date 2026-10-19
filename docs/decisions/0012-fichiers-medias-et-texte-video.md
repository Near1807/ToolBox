# 0012 — Fichiers locaux, médias et texte dans les vidéos

- Statut : acceptée
- Date : 2026-10-19

## Contexte

La phase 2 (bibliothèque de morceaux) et la phase 3 (moteur vidéo) demandent : d'importer de gros fichiers audio par glisser-déposer, de les relire dans l'interface (lecteur, covers, aperçus vidéo), et d'écrire le titre et l'artiste dans les vidéos avec une police embarquée.

## Décision

- **Import par chemin, pas par upload HTTP.** Dans l'app, le preload expose `webUtils.getPathForFile()` (`getFilePath()` du SDK) ; les sélecteurs natifs passent par `POST /api/core/dialogs/select-files`. Le frontend envoie le chemin au backend du module, qui **copie** le fichier dans son dossier de données. Pas de double copie en mémoire pour des WAV de plusieurs centaines de Mo, pas de dépendance multipart.
- **URL signées pour les médias** (`ctx.files.mediaUrl()`, route `/api/media/…`) : HMAC avec une clé par session, limitées aux dossiers du hub, Range supporté via `@fastify/static`. Voir ARCHITECTURE.md.
- **Assets de modules** (`modules/<id>/assets/`, `ctx.files.assetPath()`) : copiés dans `build/modules/` au build et extraits de l'archive asar (`asarUnpack`), car FFmpeg, process externe, ne sait pas lire dans un `.asar`.
- **Binaires** exposés aux modules par `ctx.binaries` (FFmpeg/FFprobe), sans qu'ils importent le socle.
- **Texte des vidéos avec libass** (filtre `subtitles` + fichier `.ass`), pas `drawtext` : le build Linux de FFmpeg 7 n'a pas `drawtext` (il exige harfbuzz), alors que libass est présent sous Windows (FFmpeg 6.1.1) comme sous Linux, ce qui permet de tester les rendus en CI sur les deux. Un `fonts.conf` minimal, propre à chaque rendu, limite fontconfig à la police embarquée (Montserrat, licence OFL) : pas d'analyse des polices système, rendu identique partout.
- **Graphe FFmpeg sans chemin absolu** : FFmpeg tourne dans un dossier de travail (cwd) et le graphe de filtres ne référence que des noms relatifs ; les chemins absolus ne passent que par `-i`. Aucun échappement de chemins Windows (`C\:/…`) n'est nécessaire.

## Conséquences

- Le glisser-déposer ne fonctionne que dans l'app (dans un navigateur, en dev, on utilise le bouton « Ajouter », qui ouvre le sélecteur natif).
- Les URL de médias changent à chaque lancement : l'interface les redemande au backend (jamais stockées).
