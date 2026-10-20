# 0017 — Reels rendus image par image, mouvement piloté par le son

- Statut : acceptée (complète [0016](0016-direction-artistique-sobre.md) pour les Reels)
- Date : 2026-10-20

## Contexte

En v0.8, la respiration de la cover des Reels venait d'une **détection de temps forts** (`beats.ts`), traduite en expression FFmpeg du temps (montée de 160 ms, retour de 0,45 s). En usage réel, elle n'était pas en rythme : elle bougeait sur des passages calmes (faux temps forts) et restait immobile quand ça tapait (temps forts manqués), et la montée de 160 ms plaçait le maximum de l'échelle **après** le coup. Un mouvement hors rythme est pire que pas de mouvement.

Une expression FFmpeg ne peut pas suivre finement l'énergie du son image par image, et `showcqt` ne sait dessiner qu'un spectre horizontal, pas une visualisation qui épouse le contour d'une cover arrondie et suit sa respiration.

## Décision

- **Le mouvement est piloté directement par le son, jamais par des événements détectés** (règle ajoutée à la charte). Pour chaque image (30 i/s) : énergie des basses (40–150 Hz, filtres de Butterworth), normalisée sur l'extrait, puis enveloppe à **attaque instantanée** (le maximum tombe sur l'image du coup, jamais après) et retour doux (160 ms). Échelle = 1 + 1,8 % × enveloppe. Sans basses marquées, la cover reste presque immobile.
- Pour que le maximum tombe sur la bonne image même quand le coup arrive en fin d'image, la crête d'énergie d'un coup de basse est rattachée à l'image où il commence (`backend/audio-analysis.ts`). C'est un traitement du signal, pas une détection d'événements qui déclencherait un mouvement : sans énergie, rien ne bouge.
- **Rendu image par image** dans `video-engine` pour les Reels : analyse audio en JS (FFT par image), dessin sur un canvas Skia (**`@napi-rs/canvas`**, N-API, binaires précompilés pour Windows x64 : aucune compilation), images RGBA brutes envoyées à FFmpeg par son entrée standard. Les éléments fixes (fond flouté, titre, artiste ; carte de la cover avec son ombre) sont préparés une seule fois.
- **Visualisation sur le contour de la cover** (Reels seulement) : fines barres vers l'extérieur le long du rectangle arrondi, basses en bas, aigus en haut, en miroir gauche/droite, couleur claire tirée de la cover, opacité modérée, longueur ≤ 5 % de la largeur de la cover. Elles suivent la respiration.
- YouTube garde le pipeline FFmpeg (`buildRenderArgs`, spectre horizontal `showcqt`), inchangé.
- Mesure objective obligatoire : écart entre chaque attaque de basse et le maximum de l'échelle ≤ 1 image (33 ms), testée sur des coups connus (`tests/audio-analysis.test.ts`) et mesurée sur de vrais morceaux (README du moteur).

## Alternatives écartées

- **Garder FFmpeg seul** (expressions `scale` + `showcqt`) : pas de visualisation sur un contour, synchronisation limitée à des expressions du temps.
- **`node-canvas` (Cairo)** : module natif à compiler pour Electron (node-gyp) ; `@napi-rs/canvas` est N-API, livré précompilé.
- **Rendu dans une fenêtre Electron cachée** (canvas du navigateur) : le backend n'importe pas `electron` (ADR 0001, `HostAdapter`), et la capture d'images est lente.

## Conséquences

- Nouvelle dépendance native `@napi-rs/canvas` (dans `dependencies`, externe au bundle, dépaquetée de l'asar). `npm run check:native` et le smoke test du `.exe` vérifient qu'elle charge et dessine.
- Un Reel de 28 s se rend en ~30 s sur 4 cœurs (dessin + encodage en parallèle).
- `beats.ts` est supprimé. Les Reels faits avant la v0.9 sont marqués « À régénérer » (version de rendu des Reels : 3) ; les posts ne changent pas.
