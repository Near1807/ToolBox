# 0015 — Reels : quatre styles, sans spectre

- Statut : acceptée
- Date : 2026-10-20

## Contexte

Les Reels de la v0.6 reprenaient la mise en page des vidéos YouTube (cover au centre, barres de spectre) : trop pauvres et trop semblables d'une plateforme à l'autre. Ils étaient aussi déformés : la chaîne de filtres du fond (réduction en grille puis agrandissement) laissait un rapport de pixel (SAR) de 16:9, que les lecteurs appliquaient en étirant l'image.

## Décision

- **Pixels carrés partout** : `setsar=1` en fin de chaque chaîne (fond, carte, post, vidéos) et la cover garde son ratio (inscrite dans sa boîte, jamais étirée ni recadrée pour la carte). Un test vérifie au ffprobe `SAR 1:1` et le bon DAR à pleine taille.
- **Le spectre reste la signature de YouTube** ; les Reels ont quatre styles, un par Reel du pack, modifiables un par un : Révélation (gros plan → image entière), Coupes sur le rythme (4 à 6 cadrages, changements sur les attaques), Phrase d'accroche (grand texte dès la 1re seconde), Ambiance (plein écran, poussières, grain, barre de progression).
- **Mouvements par `zoompan` sur des images fixes préparées à 2–3× la taille de sortie** : précision sous le pixel, donc des mouvements lents fluides, avec un FFmpeg 6.1 sans filtre spécial.
- **Cadrage intelligent** : une carte de détails de la cover (gradient sur 48×48) choisit la fenêtre 9:16 et les points de gros plan ; la couleur du texte (clair/sombre) dépend de la luminosité derrière lui.
- **Rythme** : attaques détectées sur l'extrait (hausse d'énergie du signal et de sa dérivée), coupes calées à l'image près.
- **Zones de sécurité Instagram** respectées : rien d'important dans les 350 px du bas ni les 150 px de droite.
- **Son** : codeur AAC « fast » (le codeur par défaut ajoutait jusqu'à +5 dB de dépassement sur des masters très forts, que la boucle true peak payait en volume).

## Conséquences

- Un Reel prend 20 à 50 s de rendu sur un PC récent (Ambiance est le plus lent : poussières en surimpression).
- Le format `instagram` du moteur produit désormais toujours un Reel stylé (`reelStyle`, `hookText`).
