# Direction artistique

> Règles **obligatoires** pour tout visuel généré par ToolBox (vidéos YouTube, Reels, images de post), présent et futur. Toute nouvelle fonction visuelle s'y conforme ; en cas de conflit, ce document l'emporte sur l'envie d'en faire plus.
>
> Ce document ne concerne que les **visuels générés**. La charte stricte vaut pour tout ce qui est fait à partir de la cover ; les Reels faits avec les vidéos de l'utilisateur ont leur section (« Reels depuis mes vidéos »). L'apparence de l'**interface** de l'app (couleurs, polices, thèmes au choix dans Réglages › Apparence) est décrite dans `docs/THEMES.md` : changer de thème ne change jamais une vidéo.

## Principe

**Le son est le produit ; le visuel est sobre et au service de la musique.** Un visuel réussi ne se remarque pas : il présente le morceau proprement, rien de plus.

## Règles

1. **La cover est toujours visible en entier.**
   - Jamais de recadrage automatique, jamais de zoom sur un détail.
   - Jamais de cadrage « intelligent » ni de détection de zones (saliency, visages…).
   - La cover garde son ratio d'origine (jamais étirée) : une cover non carrée reste non carrée.
2. **Mouvements : seulement sur l'image entière, lents et subtils.**
   - Un zoom lent de quelques % sur toute la durée.
   - Pour les Reels, une légère respiration de la cover (1,8 % d'échelle au plus) sur les basses : elle grossit **sur l'image même** du coup de basse, puis revient doucement (~160 ms). Un passage calme ne bouge presque pas.
   - Pas de coupes, pas de particules, pas d'effets, pas de transitions.
   - **Tout mouvement doit être piloté directement par le son, jamais par des événements détectés.** Un mouvement hors rythme est pire que pas de mouvement. La synchronisation se mesure : le maximum d'un mouvement tombe au plus à 1 image (33 ms) de l'attaque qui le provoque.
3. **Couleurs : uniquement celles de la cover.**
   - Le fond est la cover elle-même, très floutée, adoucie et assombrie vers le bas.
   - Aucune couleur ajoutée, palette douce (saturation et contraste réduits).
   - Seules exceptions : le blanc du texte et des barres de visualisation YouTube, et l'ombre portée. Les barres des Reels prennent une teinte claire tirée de la cover (sa couleur moyenne éclaircie).
4. **Typographie discrète et propre.**
   - Une seule police (Montserrat SemiBold), titre puis nom d'artiste en capitales espacées, centrés sous la cover.
   - Pas de contour, ombre légère.
   - Pas de texte racoleur (pas de « Nouveau son », d'accroche, d'appel à l'action dans l'image).
5. **La visualisation audio reste discrète.**
   - Fines barres semi-transparentes, échelle de fréquences logarithmique, mouvement lissé.
   - YouTube : spectre horizontal sous le texte.
   - Reels : barres le long du contour arrondi de la cover, vers l'extérieur (basses en bas, aigus en haut, en miroir gauche/droite). Elles mesurent au plus 5 % de la largeur de la cover et suivent sa respiration.
   - Elle accompagne la musique, elle ne clignote pas.
6. **Fondus doux** en entrée et en sortie (image et son) : 1,5 s / 2 s pour YouTube, 0,5 s pour les Reels.
7. **Ça doit marcher avec n'importe quelle cover**, de n'importe quel style :
   - illustration minimaliste avec beaucoup de vide ;
   - image très chargée et très colorée ;
   - photo ;
   - cover non carrée.

   Pas de réglage par cover.

8. **En cas de doute : faire moins.**

## Reels depuis mes vidéos (images de l'utilisateur)

Les règles ci-dessus (cover entière, aucun effet, couleurs de la cover) valent pour **tous les visuels faits à partir de la cover** : vidéo YouTube, Reels du pack Insta, post, miniature. Elles restent la charte stricte.

Pour les Reels faits avec **les vidéos de l'utilisateur** (module `custom-reels`), le contenu est le sien : une **banque d'effets** est autorisée, un effet par Reel, choisi par l'utilisateur. Ce qui ne change pas :

- **Tout mouvement est piloté directement par le son**, avec la même enveloppe que la respiration des covers (attaque instantanée sur l'image même du coup de basse, retour doux), jamais par des événements détectés. Synchronisation mesurée : ≤ 1 image.
- **Un effet ne masque jamais le contenu** : pas de recadrage automatique (vidéo entière sur un fond flou fait à partir d'elle-même, ou « remplir » autour d'un point **choisi par l'utilisateur**), jamais d'étirement, bandes ou vignette fines, flash léger.
- Seul le son de l'extrait du morceau est gardé (le son des vidéos n'est jamais utilisé), limité à -1 dBTP ; fondus de 0,5 s ; zones de sécurité Instagram ; pixels carrés.
- Titre et artiste discrets (même police, plus petits), au-dessus de la zone basse d'Instagram.

| Effet  | Ce qu'il fait                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Brut   | La vidéo telle quelle : ni mouvement, ni retouche, ni grain                                                                                    |
| Calme  | Zoom très lent (+4 % sur tout le Reel), couleurs adoucies (contraste et saturation un peu baissés), grain léger                                |
| Rythme | Zoom (jusqu'à +6 %) et léger flash blanc (12 % au plus) **sur les basses**, à l'image près ; plus marqué que la respiration des covers (1,8 %) |
| Ciné   | Fines bandes noires (90 px sur 1920), étalonnage « film » léger, grain, vignette douce                                                         |

Un fichier par effet : `modules/video-engine/backend/effects/` (`raw.ts`, `calm.ts`, `rhythm.ts`, `cine.ts`). Ajouter un effet = ajouter un fichier qui respecte ce qui précède, et le documenter ici.

## Mise en page

| Visuel        | Format    | Composition                                                                                                                                                                                                                                                                  |
| ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vidéo YouTube | 1920×1080 | Fond flouté ; cover au centre-haut (560 px), coins arrondis, ombre douce, zoom lent de 5 % ; titre et artiste dessous ; visualisation en bas (1400 px de large).                                                                                                             |
| Reel / Short  | 1080×1920 | Même fond ; cover centrée (boîte de 660 px, y 800), zoom lent de 2 % et respiration sur les basses ; barres fines sur le contour de la cover ; titre et artiste dessous. Tout reste hors des zones couvertes par Instagram : 350 px en bas, 150 px à droite, 220 px en haut. |
| Post          | 1080×1350 | Même fond ; cover centrée (700 px) ; titre et artiste. Rien d'autre.                                                                                                                                                                                                         |

Les 4 Reels d'un pack ont le **même style** ; seuls les extraits diffèrent. C'est voulu : l'identité du compte est stable.

## Vérifier un changement visuel

Avant de livrer une modification du rendu :

1. Rendre une vidéo YouTube, un Reel et un post avec au moins **trois covers très différentes** :
   - minimaliste avec beaucoup de vide ;
   - très chargée et colorée ;
   - non carrée.
2. Extraire des images (début, passage calme, juste avant un coup, **sur** le coup, juste après, fin) et les **regarder**. Vérifier :
   - la cover est entière ;
   - aucune zone vide n'est agrandie ;
   - le mouvement est à peine perceptible ;
   - rien n'est criard ;
   - le texte est lisible ;
   - les zones de sécurité sont respectées.
3. Mesurer :
   - ffprobe : dimensions, `SAR 1:1`, bon DAR, durées ;
   - ebur128 : true peak ≤ -1 dBTP ;
   - pour tout mouvement lié au son : l'écart entre chaque attaque et le maximum du mouvement (≤ 1 image), sur des coups connus et sur un vrai morceau.

Historique : la v0.7 a essayé des Reels « créatifs » (zooms sur des détails, coupes, particules, phrases d'accroche) ; abandonnés en v0.8 parce que non fiables selon les covers (voir `docs/decisions/0016-direction-artistique-sobre.md`). La respiration de la v0.8, déclenchée par une détection de temps forts, n'était pas en rythme ; depuis la v0.9 elle suit directement l'énergie des basses (`docs/decisions/0017-rendu-image-par-image.md`).
