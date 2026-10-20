# 0016 — Direction artistique sobre

- Statut : acceptée (remplace [0015](0015-styles-de-reels.md))
- Date : 2026-10-20

## Contexte

La v0.7 avait ajouté quatre styles de Reels (gros plans choisis par une carte des détails de la cover, coupes, particules, phrases d'accroche) et un fond « lavis de couleurs ». En usage réel, le cadrage automatique zoomait sur des zones vides (une cover minimaliste à l'encre sur papier beige n'a presque pas de « détails »), et la vidéo YouTube était devenue trop mouvementée. Un rendu doit être solide avec n'importe quelle cover, sans faute de goût possible.

## Décision

- Une **charte** obligatoire, `docs/DIRECTION-ARTISTIQUE.md` : cover toujours entière, aucun recadrage ni détection de zones, seulement des mouvements lents de l'image entière, couleurs issues de la cover, typographie discrète, « en cas de doute, faire moins ».
- **Un seul rendu**, décliné en 16:9 (YouTube) et 9:16 (Reels) par le même pipeline (`buildRenderArgs`) : fond = cover très floutée (réduite à 1/16, floutée, ré-agrandie : uniforme), carte de la cover entière, titre et artiste dessous, spectre logarithmique lissé et discret.
- **Reels** : zoom lent continu + **respiration** de la cover entière sur les temps forts (détection d'attaques conservée de la v0.7, `backend/beats.ts`) : +1 à +1,5 % d'échelle, montée en demi-cosinus de 160 ms, retour exponentiel de 0,45 s, plafonné à 1,5 % ; expression FFmpeg du temps, aucun à-coup.
- **Post** : fond, cover, titre, artiste ; la mention « Nouveau son » est retirée.
- Suppression du code des styles (`reel.ts` : saliency, recadrages, zoompan, particules, phrases), des réglages `hookPhrases` et `badge`, et des colonnes de style (migration 4 d'`instagram-video`, suppression explicite). Une colonne `render_version` marque « À régénérer » les fichiers faits avec un ancien rendu.
- Marge de 0,1 dB sur le true peak (ebur128 n'affiche qu'une décimale) : la bande-son est garantie ≤ -1 dBTP.

## Conséquences

- Les 4 Reels d'un pack se ressemblent ; seuls les extraits diffèrent (identité stable du compte).
- Toute idée visuelle future doit passer la vérification décrite dans la charte (trois covers très différentes, images regardées, mesures).
- Les réglages abandonnés (`hookPhrases`, `badge`) restent inertes dans `core__settings` : le socle n'affiche que les réglages déclarés.
