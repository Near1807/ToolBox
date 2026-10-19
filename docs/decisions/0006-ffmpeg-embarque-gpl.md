# 0006 — FFmpeg embarqué, licence GPL

- Statut : acceptée
- Date : 2026-10-19

## Contexte

La génération de vidéos repose sur FFmpeg et FFprobe. L'utilisateur ne doit rien installer à la main.

## Décision

- `ffmpeg-static` et `@derhuerst/ffprobe-static` : deux paquets du même dépôt (eugeneware/ffmpeg-static), qui téléchargent à l'installation npm des binaires statiques **du même build** (FFmpeg 7.0.2) pour la plateforme courante. `ffprobe-static` a été écarté : il fournit un FFprobe 4.0 de 2018.
- Les binaires sont dépaquetés de l'archive asar (`asarUnpack`), et `toUnpackedPath()` corrige leur chemin à l'exécution.
- **Licence** : ces binaires sont compilés avec des composants **GPL** (x264, etc.), donc soumis à la GPL v3. Pour un usage personnel non distribué, aucune obligation. **Si l'app était un jour distribuée**, il faudrait fournir le code source de FFmpeg (ou un lien), la licence, et respecter la GPL, ou passer à un build LGPL (sans x264 : encodage H.264 via un autre encodeur).

## Conséquences

- Environ 160 Mo de binaires dans l'installateur.
- `npm run dist:win` doit tourner sous Windows (ou en CI) pour embarquer les binaires Windows.
