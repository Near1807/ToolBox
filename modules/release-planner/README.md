# Planning de sortie (`release-planner`)

Le calendrier de sortie de chaque morceau, tous morceaux confondus.

- Tout ce qui va sur **YouTube** est **envoyé à l'avance et programmé directement sur YouTube** : la vidéo 16:9 et les 4 Reels du pack Insta, publiés comme **Shorts**. La sortie se fait le jour J, même PC éteint.
- Tout ce qui va sur **Instagram** (post + 4 Reels) reste **publié à la main**, avec des rappels le jour J et les fichiers + la légende prêts.

## Ce qu'il fait

1. **Compte Google** (onglet « Compte Google ») :
   - une aide pas à pas pour créer son propre projet Google Cloud ;
   - la saisie de l'ID client et du code secret (gardés par le socle, le secret chiffré) ;
   - la connexion de la chaîne, via `ctx.accounts`.
2. **« Planifier un morceau »** :
   - on choisit le morceau, le **jour J** et l'heure ; l'app propose un plan à partir du **modèle** (réglage) ;
   - chaque date reste modifiable avant « Valider le plan ». Par défaut :

   | Jour | Élément(s)                |
   | ---- | ------------------------- |
   | J    | vidéo YouTube, post Insta |
   | J+2  | Reel 1                    |
   | J+3  | Short 1                   |
   | J+5  | Reel 2                    |
   | J+6  | Short 2                   |
   | J+9  | Reel 3                    |
   | J+10 | Short 3                   |
   | J+13 | Reel 4                    |
   | J+14 | Short 4                   |
   - Le Short n est le Reel n du pack, publié sur YouTube.
   - **Anti-embouteillage** : au plus N publications par jour et par plateforme (réglage). Quand deux morceaux se chevauchent, l'élément de trop passe au premier jour libre, l'ordre du plan est gardé, et l'app le signale (« Post Insta décalé du 23/10 au 24/10 »).

3. **Avant l'envoi**, chaque élément YouTube a ses métadonnées, préremplies par les modèles des réglages et modifiables : titre, description, tags, visibilité.
   - Fixes : catégorie Musique (10), langue (réglage), « conçue pour les enfants » : non (`selfDeclaredMadeForKids = false`), contenu synthétique : non.
   - `{lien_video}` dans la description d'un Short devient le lien de la vidéo complète à l'envoi ; la ligne disparaît si la vidéo n'est pas encore en ligne.
4. **« Envoyer sur YouTube »** (par morceau ou par élément) :
   - **upload résumable** par morceaux de 8 Mo, avec progression dans Tâches ;
   - **reprise après une coupure réseau** à l'octet près (YouTube indique ce qu'il a reçu), et même après un redémarrage de l'app (la session d'envoi est gardée) ;
   - nouvelles tentatives avec attente croissante (erreurs 5xx, réseau) ; annulation possible.
   - Visibilité « Programmée » : la vidéo part en privé avec `publishAt`, la date du calendrier convertie de l'heure de Bruxelles en UTC, changements d'heure compris. YouTube la rend publique tout seul.
   - Vidéo longue : **miniature personnalisée** 1280×720, faite depuis la cover dans la même direction artistique (service `videoEngine.renderThumbnail`). Si la chaîne n'y a pas droit (non validée), un avertissement s'affiche, sans bloquer.
   - **Playlist** facultative (réglage : nom exact ou ID).
   - L'app garde l'ID et le lien de chaque vidéo.
5. **Statuts** :

   | Plateforme | Parcours                                                                                                      |
   | ---------- | ------------------------------------------------------------------------------------------------------------- |
   | YouTube    | Planifié → En attente d'envoi → Envoi en cours → Programmé sur YouTube → Publié (ou Erreur)                   |
   | Instagram  | Planifié → Publié : la case « Publié » est celle du pack Insta (même donnée, synchronisée dans les deux sens) |
   - « **En retard** » quand la date est passée sans publication. Une vidéo programmée n'est jamais en retard : YouTube s'en charge.
   - Toutes les 30 min, l'app relit le statut sur YouTube : programmée, publiée, refusée, supprimée.

6. **Calendrier** (mois / semaine) :
   - une icône par plateforme (vidéo, Short, post, Reel), une couleur par morceau ;
   - **glisser-déposer** sur un autre jour pour déplacer un élément. S'il est déjà programmé sur YouTube, la nouvelle date est envoyée tout de suite (`videos.update`).
7. **Aujourd'hui** (en haut de la page, et **widget** sur l'accueil du hub) : ce qui est à publier aujourd'hui et ce qui est en retard, avec la miniature à **glisser** vers Instagram, **« Copier la légende »** et la case « Publié ».
8. **Rappels** : notification Windows à l'heure prévue (si l'app tourne) et, au démarrage, une notification pour tout ce qui est dû ou en retard. Un clic ouvre l'élément.
   - Pour que les rappels tournent sans ouvrir l'app : Réglages › Général › « Lancer ToolBox au démarrage de Windows » (réduit dans la zone de notification).
9. **Fichiers** : chaque élément pointe vers son fichier via `ctx.outputs` (sujet `music-library:track:<id>`).
   - Fichier supprimé ou introuvable : l'élément est marqué, avec « Régénérer » (rendu relancé par le module d'origine) ou « Retirer du planning ».
   - Une nouvelle vidéo YouTube générée remplace automatiquement celle qui a disparu.
10. **Retirer** un élément ou un morceau du planning ne supprime jamais une vidéo déjà en ligne sans choix explicite : « Retirer du planning seulement » ou « Supprimer aussi sur YouTube » (confirmé).

## Premier essai (vidéo de test en privé)

1. **Google Cloud** : suis l'onglet « Compte Google » du module, étapes 1 à 4. Écran de consentement en **Production**, identifiant de type **Application de bureau**.
2. **Identifiants** : colle l'ID client et le code secret, puis « Enregistrer les identifiants ».
3. **Connexion** : « Connecter mon compte Google ». Dans le navigateur, choisis le compte de ta chaîne. À l'écran « Google n'a pas validé cette application », clique « Paramètres avancés » › « Accéder à ToolBox », puis « Autoriser ». ToolBox doit afficher « Connecté » et le nom de ta chaîne.
4. **Plan de test** : prends un morceau qui a déjà une vidéo YouTube générée. « Planifier un morceau », J = **après-demain**, heure = maintenant + quelques heures, « Valider le plan ».
5. **Vidéo en privé** : dans le calendrier, ouvre l'élément « Vidéo YouTube ». Mets la visibilité sur **« Privée »** et le titre sur « TEST ToolBox — à supprimer », puis « Enregistrer ».
   - Pour ne pas envoyer les Shorts pendant l'essai, retire-les du planning (« Retirer »).
   - Ou laisse les Shorts et envoie seulement la vidéo, avec le bouton du panneau.
6. **Envoi** : « Envoyer et programmer » dans le panneau. La progression s'affiche, aussi dans **Tâches**. À la fin, l'élément passe « À programmer dans Studio » : c'est attendu en visibilité « Privée ».
7. **Vérification dans YouTube Studio** (lien « Ouvrir dans YouTube Studio ») : vidéo privée, catégorie Musique, titre, description, tags, miniature (ou l'avertissement « chaîne non validée » dans ToolBox).
8. **Programmation** : sur un deuxième élément, une Short de test par exemple, laisse la visibilité **« Programmée »** avec une date dans 2 jours. Envoie, puis vérifie dans Studio « Programmée » et l'heure.
   - Glisse l'élément sur un autre jour du calendrier : Studio doit montrer la nouvelle date.
   - Si l'élément passe « À programmer dans Studio » avec l'avertissement « projet non audité », YouTube bloque ton projet en privé : voir ci-dessous.
9. **Nettoyage** : « Retirer » › « Supprimer aussi sur YouTube » efface les vidéos de test.

## YouTube : règles vérifiées (octobre 2026)

| Sujet               | Règle                                                                                                                                                                                                                                                                                                                          | Ce que fait l'app                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projets non audités | Les vidéos de projets créés après le 28/07/2020 et non audités étaient bloquées en privé. La référence de l'API (révision du 19/10/2026, `status.privacyStatus`) dit désormais : « Videos uploaded from unverified API projects are not restricted to private viewing mode » ; certaines pages d'aide disent encore l'inverse. | L'app lit la réponse de YouTube après chaque envoi. Vidéo restée privée sans date → « À programmer dans Studio », lien direct et rappel. Lien vers le [formulaire d'audit](https://support.google.com/youtube/contact/yt_api_form) dans l'aide.         |
| Quota               | Quota quotidien par projet, remis à zéro à minuit heure du Pacifique. Coûts : 10 000 unités par défaut ; `videos.insert` comptait 1 600 unités, et YouTube passe en 2026 à un quota d'envois séparé. Autres coûts : `videos.update`, `thumbnails.set`, `playlistItems.insert`, `videos.delete` 50 ; lectures 1.                | Envois et unités comptés à part, avec des limites réglables (6 envois/jour par défaut). La file d'attente étale sur les jours suivants et le dit (« 3 envoi(s) reporté(s), le premier le 21/10 à 09:00 »). Une réponse `quotaExceeded` clôt la journée. |
| Scopes              | `videos.update` (déplacer une date) et `playlistItems.insert` exigent `youtube` (ou `youtube.force-ssl`) ; `youtube.upload` ne suffit pas.                                                                                                                                                                                     | Une seule autorisation : `https://www.googleapis.com/auth/youtube`.                                                                                                                                                                                     |
| `publishAt`         | Seulement si `privacyStatus` est `private` ; dans `videos.update`, toute la partie `status` est renvoyée, sinon les champs omis sont réinitialisés.                                                                                                                                                                            | `statusPart()` envoie toujours la partie complète.                                                                                                                                                                                                      |
| Shorts              | Vidéo verticale ou carrée de 3 min au plus : classée Short automatiquement, sans champ d'API.                                                                                                                                                                                                                                  | Les Reels (9:16, < 1 min) sont envoyés tels quels, avec leur propre titre et description.                                                                                                                                                               |
| Miniatures          | Chaîne validée par téléphone requise, image ≤ 2 Mo.                                                                                                                                                                                                                                                                            | JPEG 1280×720 bien sous 2 Mo ; un refus 403 donne un avertissement.                                                                                                                                                                                     |

## Données

| Élément              | Détail                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables (migration 1) | `release_planner__releases` : une par morceau, jour J, vidéo choisie, miniature. `release_planner__items` : un élément par publication — date UTC, date d'origine si décalée, élément du pack, métadonnées YouTube, état, session d'envoi, ID YouTube, avertissement/erreur, rappel. `release_planner__quota` : envois et unités par jour de quota. |
| Fichiers             | miniatures YouTube dans `<dossier de sortie>/release-planner/`, enregistrées dans `ctx.outputs` (ref `thumbnail:<id>`)                                                                                                                                                                                                                              |
| Compte               | `google` via `ctx.accounts` (jetons chiffrés par le socle, table `core__accounts`)                                                                                                                                                                                                                                                                  |
| Tâches               | `upload` `{ itemId }` (une à la fois)                                                                                                                                                                                                                                                                                                               |
| Tâches planifiées    | `dispatch` (chaque minute : envois autorisés par le quota, rappels) · `youtube-status` (toutes les 30 min)                                                                                                                                                                                                                                          |
| Événement écouté     | `youtube-video:video.created` (remplace une vidéo disparue)                                                                                                                                                                                                                                                                                         |

## Réglages

| Clé                              | Rôle                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultTime`, `timeZone`        | heure par défaut ; fuseau (`Europe/Brussels`)                                                                                                                                   |
| `planTemplate`                   | modèle du plan, une ligne par jour                                                                                                                                              |
| `maxPerDay`                      | publications max par jour et par plateforme (anti-embouteillage)                                                                                                                |
| `videoTitle`, `videoDescription` | modèles de la vidéo longue. Repères : `{titre}`, `{artiste}`, `{titre_youtube}`, `{description_youtube}` (préparés par Vidéo YouTube : liens, hashtags), `{hashtags}`, `{date}` |
| `shortTitle`, `shortDescription` | modèles des Shorts. Repères : `{n}`, `{total}`, `{lien_video}`…                                                                                                                 |
| `extraTags`                      | tags YouTube en plus de ceux du morceau                                                                                                                                         |
| `language`                       | langue des métadonnées (`defaultLanguage`, `defaultAudioLanguage`)                                                                                                              |
| `playlist`                       | playlist de la chaîne (nom ou ID), facultative                                                                                                                                  |
| `uploadsPerDay`, `unitsPerDay`   | limites de quota                                                                                                                                                                |
| `remindInstagram`                | notifications de rappel                                                                                                                                                         |

## Dépendances

| Type                                                  | Détail                                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modules                                               | `music-library`, `video-engine`, `youtube-video`, `instagram-video`                                                                                                     |
| Services (via `ctx.services`, jamais d'import direct) | `musicLibrary` (morceaux) · `youtubeVideo` (vidéos, textes, rendu, « en ligne ») · `instagramPack` (pack, légendes, case « Publié », rendu) · `videoEngine` (miniature) |
| Compte                                                | `google` (`permissions.accounts`)                                                                                                                                       |

## API

| Méthode | Route                                         | Rôle                                                                                            |
| ------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET     | `/summary`                                    | Aujourd'hui, fuseau, compte, quota, message de file d'attente, erreurs du modèle                |
| GET     | `/calendar?from=&to=`                         | Éléments d'une période (dates locales)                                                          |
| GET     | `/today`                                      | À publier aujourd'hui, en retard, 7 prochains jours                                             |
| GET     | `/tracks`                                     | Morceaux, avec vidéo, pack et sortie existante                                                  |
| POST    | `/plan`                                       | Proposition : `{ trackId, date, time, videoId? }` → éléments, décalages, avertissements         |
| POST    | `/releases`                                   | Crée le plan (`items` : dates modifiées, facultatif)                                            |
| GET     | `/releases` · `/releases/:id`                 | Sorties planifiées                                                                              |
| PATCH   | `/releases/:id`                               | `{ videoId }` : autre vidéo générée                                                             |
| DELETE  | `/releases/:id?online=keep\|delete`           | Retire le morceau du planning                                                                   |
| POST    | `/releases/:id/upload`                        | Envoie tous les éléments YouTube                                                                |
| PATCH   | `/items/:id`                                  | `{ date?, time?, title?, description?, tags?, visibility? }` (déjà programmé : `videos.update`) |
| POST    | `/items/:id/upload` · `/items/:id/cancel`     | Envoyer / annuler                                                                               |
| POST    | `/items/:id/published`                        | Instagram : case « Publié » du pack                                                             |
| POST    | `/items/:id/regenerate` · `/items/:id/reveal` | Régénérer le fichier / le montrer                                                               |
| DELETE  | `/items/:id?online=keep\|delete`              | Retire l'élément                                                                                |
| POST    | `/check-now`                                  | Relit le statut sur YouTube                                                                     |
| GET     | `/account` · POST `/account/connect`          | Compte Google (chaîne) / connexion                                                              |

## Code

| Fichier              | Contenu                                                         |
| -------------------- | --------------------------------------------------------------- |
| `backend/plan.ts`    | modèle, plan, anti-embouteillage, métadonnées (fonctions pures) |
| `backend/time.ts`    | fuseaux et changements d'heure, jour de quota                   |
| `backend/quota.ts`   | file d'attente du quota                                         |
| `backend/status.ts`  | machine à états                                                 |
| `backend/youtube.ts` | client de l'API, upload résumable                               |

Tests : unitaires (`tests/plan.test.ts`), client contre un faux serveur (`tests/youtube-client.test.ts`), module complet avec faux Google (`tests/release-planner.test.ts`, `tests/mock-google.ts`).
