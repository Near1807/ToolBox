# 0023 — Reels depuis les vidéos de l'utilisateur : module séparé, banque d'effets

- Statut : acceptée
- Date : 2026-10-21

## Contexte

Thomas veut des Reels faits avec ses propres vidéos (tournages, clips), sur un extrait du morceau. La direction artistique (ADR 0016) interdit tout effet, mais elle a été écrite pour des visuels faits à partir de la cover.

## Décision

- **Un module séparé** `custom-reels`, sur le modèle du Pack Insta (mêmes composants partagés, même suivi de publication, même rattachement au morceau). Le rendu est dans le moteur vidéo (`renderVideoReel`), pour rester l'unique moteur.
- **Vidéos copiées** dans ToolBox à l'import, comme les sons de la Bibliothèque : l'interface ne peut lire que les fichiers des dossiers de l'app (URL signées), et déplacer un original ne doit rien casser. Coût : l'espace disque d'une copie.
- **Charte en deux parties** : stricte pour tout ce qui part de la cover ; pour les vidéos de l'utilisateur, une banque d'effets (un par Reel) est permise, mais tout mouvement reste piloté directement par le son (même enveloppe que les covers, ≤ 1 image) et aucun effet ne masque le contenu (pas de recadrage automatique, bandes et vignette fines).
- **Rendu** : FFmpeg décode, cadre et étalonne ; JS n'applique que le mouvement (zoom bilinéaire, flash) et seulement quand l'effet en a un ; la couche fixe (titre, bandes, vignette) est posée par FFmpeg à l'encodage. Passer chaque image par le canvas (`putImageData` / `data()`) coûtait ~180 ms par image en 1080×1920 ; cette répartition est 2,5 fois plus rapide.
- Le son des vidéos n'est jamais lu : seule la bande-son du morceau, limitée et vérifiée à -1 dBTP comme partout.

## Conséquences

- Un effet = un fichier dans `video-engine/backend/effects/`, documenté dans la direction artistique.
- Le Planning de sortie lit ces Reels par le service `customReels` (Reel Instagram et/ou Short YouTube).
