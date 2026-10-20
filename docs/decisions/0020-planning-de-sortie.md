# 0020 — Planning de sortie : programmation sur YouTube, rappels pour Instagram

- Statut : acceptée
- Date : 2026-10-20

## Contexte

Pour chaque morceau, la vidéo YouTube et le pack Insta (post + 4 Reels) sont déjà générés. Il faut les sortir étalés dans le temps, sans dépendre de l'ordinateur pour YouTube, et sans erreur de date (heure de Bruxelles, changements d'heure).

## Décision

- **Un module `release-planner`**, consommateur de services : `youtubeVideo` (vidéos, textes, rendu, marquage « en ligne »), `instagramPack` (pack, légendes, case « Publié », rendu) et `videoEngine` (miniature). `youtube-video` et `instagram-video` fournissent ces services, sans dépendre du planning. L'emplacement d'upload prévu dans `youtube-video` (`upload.ts`, jamais implémenté) est retiré : publier, c'est planifier.
- **YouTube** :
  - chaque élément (vidéo, et les Reels publiés comme Shorts) est envoyé **à l'avance** en privé avec `status.publishAt` : YouTube publie seul le jour J, PC éteint ;
  - upload **résumable** maison (protocole HTTP documenté, ~150 lignes) : reprise à l'octet près après une coupure, y compris après un redémarrage de l'app (l'URL de session est en base) ;
  - **une seule autorisation** : `youtube`. `youtube.upload` ne permet ni de déplacer une date (`videos.update`) ni d'ajouter à une playlist.
- **Instagram** : publication manuelle (pas d'API sans compte professionnel et app Meta). Rappels (ADR 0019), fichiers à glisser, légende à copier. La case « Publié » reste celle du pack Insta : une seule donnée, pas de synchronisation à maintenir.
- **Projet Google non audité** : la référence de l'API (révision du 19/10/2026) dit que les vidéos de projets non vérifiés ne sont plus bloquées en privé. Le blocage existait depuis 2020 et certaines pages d'aide le décrivent encore. L'app ne suppose rien : elle lit l'état renvoyé par YouTube après chaque envoi et à chaque relevé (toutes les 30 min). Une vidéo privée sans date passe en « À programmer dans Studio », avec lien direct et rappel ; c'est le mode de repli.
- **Quota** : YouTube passe en 2026 à un quota d'envois séparé ; l'ancien coût était de 1 600 unités sur 10 000 par jour. L'app compte envois et unités à part, par jour de quota (minuit, heure du Pacifique), avec des limites réglables prudentes (6 envois/jour). Elle étale la file sur les jours suivants en le disant. Une réponse `quotaExceeded` clôt la journée.
- **Fonctions pures testées** : modèle de plan, anti-embouteillage (N publications max par jour et par plateforme, ordre gardé), fuseau horaire (Intl, sans bibliothèque ; heure inexistante → +1 h, heure ambiguë → la première), file du quota, machine à états.
- Supprimer un élément ou un morceau du planning ne supprime jamais une vidéo en ligne sans choix explicite (« Supprimer aussi sur YouTube », confirmé).

## Alternatives écartées

- **Publier au moment voulu depuis le PC** (pas de `publishAt`) : dépend du PC allumé, contraire au besoin.
- **Bibliothèque `googleapis`** : voir ADR 0018 ; l'upload résumable reste simple à écrire et à tester avec un faux serveur.
- **Dupliquer l'état « Publié » d'Instagram** dans le planning : deux vérités à synchroniser.

## Conséquences

- Premier usage : mise en place du projet Google Cloud (ADR 0018), puis un essai avec une vidéo privée (marche à suivre dans le README du module).
- Si Google rétablit le blocage en privé, l'app continue de fonctionner (mode de repli) ; l'audit gratuit lève la restriction.
