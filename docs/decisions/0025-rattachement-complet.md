# 0025 — Rattachement complet : chaque module suit (`ctx.outputs.onReattach`)

- Statut : acceptée
- Date : 2026-10-22

## Contexte

En v0.12 (ADR 0022), « Sans projet » > Rattacher ne changeait que le projet de l'élément dans le registre du socle. La ligne propre du module (la vidéo YouTube, l'élément du pack, le Reel perso) gardait l'ancien morceau supprimé : l'élément apparaissait dans la vue projet du nouveau morceau, mais pas dans la page du module pour ce morceau, ni dans le Planning.

## Décision

- **Nouveau crochet du contrat** : `ctx.outputs.onReattach((records, subject) => …)`, obligatoire pour tout module qui enregistre des fichiers. Le socle met à jour le registre, puis appelle le crochet de chaque module propriétaire, **dans la même transaction SQLite** : tout ou rien. Le crochet est synchrone ; il lève une erreur (HttpError 409) pour refuser, avec un message affiché tel quel.
- **Refus si un module propriétaire n'a pas de crochet** (absent, désactivé, trop ancien) : mieux vaut ne rien rattacher qu'un rattachement à moitié.
- **Le socle reste générique** : `subject` est une chaîne. Pour la Musique, le service `musicLibrary` gagne `trackIdOf(subject)` (null si ce n'est pas un morceau existant).
- **Ce que fait chaque module** :
  - Vidéo YouTube : la vidéo change de morceau.
  - Pack Instagram (un pack par morceau) : si le morceau choisi n'a pas de pack, le pack entier suit ; sinon le fichier prend la même place (post, Reel n) dans le pack existant, refusé si cette place a déjà un fichier ; l'ancienne place redevient « À générer ».
  - Reels perso : le Reel prend la première place libre (4 au plus, sinon refusé), avec les vidéos importées qu'il utilise.
  - Planning : une miniature quitte sa sortie d'origine ; la sortie du morceau choisi l'adopte si elle n'en a pas.
  - Modèle : rien à déplacer (crochet vide, commenté).

## Conséquences

- Testé avec les vrais modules : déplacement, place prise (refus sans aucun changement), adoption de la miniature.
- La case « Inclure dans la sortie » suit l'élément vers son nouveau morceau (sauf quand le fichier change de place dans un pack : il est alors inclus, la valeur par défaut).
