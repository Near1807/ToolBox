# Direction artistique

> Règles **obligatoires** pour tout visuel généré par ToolBox (vidéos YouTube, Reels, images de post), présent et futur. Toute nouvelle fonction visuelle s'y conforme ; en cas de conflit, ce document l'emporte sur l'envie d'en faire plus.

## Principe

**Le son est le produit ; le visuel est sobre et au service de la musique.** Un visuel réussi ne se remarque pas : il présente le morceau proprement, rien de plus.

## Règles

1. **La cover est toujours visible en entier.**
   - Jamais de recadrage automatique, jamais de zoom sur un détail.
   - Jamais de cadrage « intelligent » ni de détection de zones (saliency, visages…).
   - La cover garde son ratio d'origine (jamais étirée) : une cover non carrée reste non carrée.
2. **Mouvements : seulement sur l'image entière, lents et subtils.**
   - Un zoom lent de quelques % sur toute la durée.
   - Pour les Reels, une légère respiration (1 à 1,5 % d'échelle) sur les temps forts, avec retour doux.
   - Pas de coupes, pas de particules, pas d'effets, pas de transitions.
3. **Couleurs : uniquement celles de la cover.**
   - Le fond est la cover elle-même, très floutée, adoucie et assombrie vers le bas.
   - Aucune couleur ajoutée, palette douce (saturation et contraste réduits).
   - Seules exceptions : le blanc du texte et des barres de visualisation, et l'ombre portée.
4. **Typographie discrète et propre.**
   - Une seule police (Montserrat SemiBold), titre puis nom d'artiste en capitales espacées, centrés sous la cover.
   - Pas de contour, ombre légère.
   - Pas de texte racoleur (pas de « Nouveau son », d'accroche, d'appel à l'action dans l'image).
5. **La visualisation audio reste discrète.**
   - Fines barres blanches semi-transparentes, échelle de fréquences logarithmique, mouvement lissé.
   - Elle accompagne la musique, elle ne clignote pas.
6. **Fondus doux** en entrée et en sortie (image et son) : 1,5 s / 2 s pour YouTube, 0,5 s pour les Reels.
7. **Ça doit marcher avec n'importe quelle cover**, de n'importe quel style :
   - illustration minimaliste avec beaucoup de vide ;
   - image très chargée et très colorée ;
   - photo ;
   - cover non carrée.

   Pas de réglage par cover.

8. **En cas de doute : faire moins.**

## Mise en page

| Visuel        | Format    | Composition                                                                                                                                                                                                                                                     |
| ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vidéo YouTube | 1920×1080 | Fond flouté ; cover au centre-haut (560 px), coins arrondis, ombre douce, zoom lent de 5 % ; titre et artiste dessous ; visualisation en bas (1400 px de large).                                                                                                |
| Reel / Short  | 1080×1920 | Même fond ; cover centrée (740 px, ~70 % de la largeur), zoom lent de 3 % et respiration sur les temps forts ; titre et artiste dessous ; visualisation fine sous le texte. Tout reste hors des zones couvertes par Instagram : 350 px en bas, 150 px à droite. |
| Post          | 1080×1350 | Même fond ; cover centrée (700 px) ; titre et artiste. Rien d'autre.                                                                                                                                                                                            |

Les 4 Reels d'un pack ont le **même style** ; seuls les extraits diffèrent. C'est voulu : l'identité du compte est stable.

## Vérifier un changement visuel

Avant de livrer une modification du rendu :

1. Rendre une vidéo YouTube, un Reel et un post avec au moins **trois covers très différentes** :
   - minimaliste avec beaucoup de vide ;
   - très chargée et colorée ;
   - non carrée.
2. Extraire des images (début, temps fort, juste après, fin) et les **regarder**. Vérifier :
   - la cover est entière ;
   - aucune zone vide n'est agrandie ;
   - le mouvement est à peine perceptible ;
   - rien n'est criard ;
   - le texte est lisible ;
   - les zones de sécurité sont respectées.
3. Mesurer :
   - ffprobe : dimensions, `SAR 1:1`, bon DAR, durées ;
   - ebur128 : true peak ≤ -1 dBTP.

Historique : la v0.7 a essayé des Reels « créatifs » (zooms sur des détails, coupes, particules, phrases d'accroche) ; abandonnés en v0.8 parce que non fiables selon les covers (voir `docs/decisions/0016-direction-artistique-sobre.md`).
