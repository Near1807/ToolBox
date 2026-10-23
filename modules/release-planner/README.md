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
   | J+1  | Reel 1, Short 1           |
   | J+2  | Reel 2, Short 2           |
   | J+3  | Reel 3, Short 3           |
   | J+4  | Reel 4, Short 4           |
   - Le Short n est le Reel n du pack, publié sur YouTube.
   - **« J tombe toujours un lundi »** (réglage, activé par défaut) : la date choisie est reportée au lundi suivant, et c'est dit. Avec les **jours de publication autorisés** (réglage, lundi à vendredi par défaut), le plan par défaut tient dans la semaine.
   - **Seulement ce qui est coché « Inclure dans la sortie »** sur la page du morceau (Bibliothèque) : exclure le Reel n retire le Reel n et le Short n ; les éléments exclus sont listés.
   - **Reels perso** (« Reels depuis mes vidéos ») : proposés à part, décochés, comme Reel Instagram et/ou Short YouTube, chacun un jour autorisé après la fin du plan.
   - **« Ajouter un Reel perso »** (sur une sortie déjà planifiée, si « Reels depuis mes vidéos » est présent) : choix du Reel (seulement ceux inclus dans la sortie), de la plateforme (Reel Insta et/ou Short, ceux déjà planifiés sont grisés) et de la date, proposée le jour autorisé suivant la fin du plan. Un jour non autorisé est refusé, avec la liste des jours autorisés.
   - **Anti-embouteillage** : au plus N publications par jour et par plateforme (réglage). Quand deux morceaux se chevauchent, l'élément de trop passe au premier jour libre **et autorisé** (jamais un jour non coché), l'ordre du plan est gardé, et l'app le signale (« Post Insta décalé du 23/10 au 24/10 » ; un élément qui tombait un jour non autorisé est signalé à part).

3. **Avant l'envoi**, chaque élément YouTube a ses métadonnées, préremplies par les modèles des réglages et modifiables : titre, description, tags, visibilité.
   - Fixes : catégorie Musique (10), langue (réglage), « conçue pour les enfants » : non (`selfDeclaredMadeForKids = false`), contenu synthétique : non.
   - `{lien_video}` dans la description d'un Short devient le lien de la vidéo complète à l'envoi ; la ligne disparaît si la vidéo n'est pas encore en ligne.
4. **« Envoyer sur YouTube »** (par morceau ou par élément). Sous le bouton : « Envoie maintenant les N vidéos en privé ; YouTube les publiera seul à leur date, même PC éteint. Rien ne part sans ce clic (sauf envoi automatique activé). Garde ToolBox ouvert pendant l'envoi. »
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
   - Toutes les 30 min, l'app relit le statut sur YouTube : programmée, publiée, refusée, supprimée. Bouton **« Vérifier sur YouTube maintenant »** pour le faire tout de suite.
   - Une vidéo restée privée sans date (« À programmer dans Studio ») est **notifiée dès la fin de l'envoi**, avec le lien direct vers YouTube Studio.

6. **Calendrier** (mois / semaine) :
   - une icône par plateforme (vidéo, Short, post, Reel), une couleur par morceau ;
   - **glisser-déposer** sur un autre jour pour déplacer un élément. S'il est déjà programmé sur YouTube par l'app (visibilité « Programmée »), la nouvelle date est envoyée tout de suite (`videos.update`). Une vidéo envoyée en « Privée » (ou publique, non répertoriée) ne bouge que dans le calendrier : rien n'est changé sur YouTube.
7. **Aujourd'hui** (en haut de la page, et **widget** sur l'accueil du hub) : ce qui est à publier aujourd'hui et ce qui est en retard, avec la miniature à **glisser** vers Instagram, **« Copier la légende »** et la case « Publié ».
8. **Rappels** : notification Windows à l'heure prévue (si l'app tourne) et, au démarrage, une notification pour tout ce qui est dû ou en retard. Un clic ouvre l'élément.
   - Pour que les rappels tournent sans ouvrir l'app : Réglages › Général › « Lancer ToolBox au démarrage de Windows » (réduit dans la zone de notification).
   - **J-3 et J-1** : notification (une fois chacune) et alerte sur le widget et en haut du planning pour les vidéos YouTube **pas encore envoyées** dont la première date approche.
   - **Envoi automatique** (réglage, désactivé par défaut) : les éléments YouTube d'une sortie partent seuls X jours avant leur première date (3 par défaut), ou au prochain lancement si l'app était fermée ; seulement ceux dont la date est encore à venir. Notification au début, puis à la fin ou en cas d'échec. Les alertes J-3 / J-1 restent actives.
   - **Fermer la fenêtre pendant un envoi** (sans la zone de notification) demande confirmation : l'envoi s'arrête et reprendra au prochain lancement.
9. **Fichiers** : chaque élément pointe vers son fichier via `ctx.outputs` (sujet `music-library:track:<id>`).
   - Fichier supprimé ou introuvable : l'élément est marqué, avec « Régénérer » (rendu relancé par le module d'origine) ou « Retirer du planning ».
   - Une nouvelle vidéo YouTube générée remplace automatiquement celle qui a disparu.
10. **Retirer** un élément ou un morceau du planning ne supprime jamais une vidéo déjà en ligne sans choix explicite : « Retirer du planning seulement » ou « Supprimer aussi sur YouTube » (confirmé).

## Mise en place du compte Google (une seule fois)

Google exige une page d'accueil et une politique de confidentialité publiques pour passer l'écran de consentement en Production. Elles sont publiées par GitHub Pages depuis ce dépôt (dossier `site/`, workflow `.github/workflows/pages.yml`, branche `hub-v1`) :

- Page d'accueil : <https://near1807.github.io/ToolBox/>
- Confidentialité : <https://near1807.github.io/ToolBox/privacy.html>

**Activer GitHub Pages** (une fois, dans le dépôt GitHub) :

1. Settings › **Pages** › Build and deployment › Source : **GitHub Actions**.
2. Settings › **Environments** › `github-pages` › Deployment branches and tags › « Add deployment branch or tag rule » › `hub-v1`. Par défaut, seul `main` peut déployer.
3. Actions › « Site (GitHub Pages) » › relancer le dernier run, ou pousser un changement de `site/`. Les pages répondent ensuite aux adresses ci-dessus.

**Console Google Cloud** (<https://console.cloud.google.com>, connecté avec le compte de ta chaîne) :

1. **Projet** : « Nouveau projet », nom « ToolBox ».
2. **API** : API et services › Bibliothèque › « YouTube Data API v3 » › **Activer**.
3. **Google Auth Platform › Branding** :
   - Nom de l'application : « ToolBox ». E-mail d'assistance : ton adresse.
   - Logo : **aucun** (un logo déclenche une validation par Google).
   - Page d'accueil de l'application : `https://near1807.github.io/ToolBox/`.
   - Lien vers les règles de confidentialité : `https://near1807.github.io/ToolBox/privacy.html`.
   - Conditions d'utilisation : vide.
   - Domaines autorisés : `near1807.github.io`. Coordonnées du développeur : ton e-mail.
   - « Enregistrer ».
4. **Audience** :
   - Type d'utilisateur : **Externe**.
   - Puis **« Publier l'application »** › « Confirmer » : statut **En production**.
   - **Ne pas soumettre à la validation** (« Préparer la validation » / « Valider l'application ») : inutile pour un usage personnel. L'app reste « non validée » : 100 utilisateurs au plus et un avertissement à la connexion.
5. **Accès aux données** : n'ajoute aucun champ d'application. ToolBox demande `youtube` à la connexion ; en déclarer un champ sensible ici pousse vers la validation.
6. **Clients** : « Créer un client » › type **Application de bureau** › nom « ToolBox ». Copie l'**ID client** et le **code secret** dans ToolBox (onglet « Compte Google », ou Réglages › Comptes connectés).
7. **Connexion** depuis ToolBox : « Connecter mon compte Google ».
   - Dans le navigateur, choisis le compte de ta chaîne.
   - À l'écran **« Google n'a pas validé cette application »** : « Paramètres avancés » › **« Accéder à ToolBox (non sécurisé) »**. C'est normal : c'est ton propre projet.
   - Coche l'autorisation YouTube si elle est proposée, puis « Continuer ».
   - ToolBox affiche « Connecté » et le nom de la chaîne.

**Si l'autorisation expire ou est retirée**, par exemple au bout de 7 jours si l'app est restée en mode « Test » :

- bandeau rouge « Compte Google à reconnecter » avec un bouton **Reconnecter** dans le planning, et alerte sur le widget de l'accueil ;
- une notification Windows, une seule par expiration ;
- les envois ne partent pas en erreur : ils restent **en attente** et repartent seuls après la reconnexion.

Si Google est injoignable (réseau coupé), l'envoi est retenté 15 minutes plus tard.

## Premier essai (vidéo de test en privé)

1. **Google Cloud** : fais la mise en place ci-dessus (ou suis l'onglet « Compte Google » du module, mêmes étapes).
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

| Élément                 | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables (migrations 1–3) | `release_planner__releases` : une par morceau, jour J, vidéo choisie, miniature. `release_planner__items` : un élément par publication — date UTC, date d'origine si décalée, élément du pack, métadonnées YouTube, état, session d'envoi, ID YouTube, avertissement/erreur, rappel ; migration 3 : Reel perso source (`custom_reel_id`), alertes J-3 / J-1 envoyées, début et fin de l’envoi automatique d’une sortie. `release_planner__quota` : envois et unités par jour de quota. |
| Fichiers                | miniatures YouTube dans `<dossier de sortie>/release-planner/`, enregistrées dans `ctx.outputs` (ref `thumbnail:<id>`)                                                                                                                                                                                                                                                                                                                                                                 |
| Compte                  | `google` via `ctx.accounts` (jetons chiffrés par le socle, table `core__accounts`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tâches                  | `upload` `{ itemId }` (une à la fois)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Tâches planifiées       | `dispatch` (chaque minute : envois autorisés par le quota, rappels) · `youtube-status` (toutes les 30 min)                                                                                                                                                                                                                                                                                                                                                                             |
| Événement écouté        | `youtube-video:video.created` (remplace une vidéo disparue)                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Réglages

| Clé                              | Rôle                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultTime`, `timeZone`        | heure par défaut ; fuseau (`Europe/Brussels`)                                                                                                                                   |
| `planTemplate`                   | modèle du plan, une ligne par jour                                                                                                                                              |
| `maxPerDay`                      | publications max par jour et par plateforme (anti-embouteillage)                                                                                                                |
| `allowedDays`, `mondayRelease`   | jours de publication autorisés (lun–ven) ; J toujours un lundi (oui)                                                                                                            |
| `videoTitle`, `videoDescription` | modèles de la vidéo longue. Repères : `{titre}`, `{artiste}`, `{titre_youtube}`, `{description_youtube}` (préparés par Vidéo YouTube : liens, hashtags), `{hashtags}`, `{date}` |
| `shortTitle`, `shortDescription` | modèles des Shorts. Repères : `{n}`, `{total}`, `{lien_video}`…                                                                                                                 |

| `extraTags` | tags YouTube en plus de ceux du morceau |
| `language` | langue des métadonnées (`defaultLanguage`, `defaultAudioLanguage`) |
| `playlist` | playlist de la chaîne (nom ou ID), facultative |
| `uploadsPerDay`, `unitsPerDay` | limites de quota |
| `remindInstagram` | notifications de rappel |
| `autoUpload`, `autoUploadDays` | envoi automatique (non) ; combien de jours avant (3) |

Les modèles **ne font que pré-remplir** : dans le panneau d'un élément, titre, description et tags (YouTube) ou légende (Instagram, enregistrée dans le pack) se modifient sur place avec le composant partagé `TextFields`. Tant qu'un élément n'est pas modifié, ses textes suivent les modèles (et les textes de Vidéo YouTube) ; une fois modifié, il est « Personnalisé » (colonne `texts_custom`, migration 2 : les éléments créés avant sont considérés personnalisés, leurs textes ne bougent pas). « Rétablir le modèle » y revient ; « Enregistrer comme modèle par défaut » met à jour le modèle des réglages.

## Dépendances

| Type                             | Détail                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Obligatoire                      | `music-library`, service `musicLibrary` (morceaux, vue projet) : une sortie est celle d'un morceau                                                                                                                                                                                                                                |
| Facultatifs (`optionalServices`) | `youtubeVideo` (vidéos, textes, rendu, « en ligne ») · `instagramPack` (pack, légendes, case « Publié », rendu) · `customReels` (Reels perso) · `videoEngine` (miniature)                                                                                                                                                         |
| Service fourni                   | `releasePlanner` ([`contract.ts`](contract.ts)) : `listYouTubeItems()` — chaque élément YouTube des sorties (vidéo longue, Short n, Short perso n) avec son morceau, sa source (pack, Reel perso), sa date prévue et son identifiant YouTube une fois envoyé. Utilisé par Stats YouTube pour relier les statistiques aux morceaux |
| Assistant                        | `agenda` (aujourd'hui avec les retards, 7 prochains jours, en retard), `release` (sortie d'un morceau) en lecture ; `upload`, `move`, `publish` déclarées **sensibles** : jamais exécutées, l'assistant propose d'ouvrir le Planning                                                                                              |
| Compte                           | `google` (`permissions.accounts`)                                                                                                                                                                                                                                                                                                 |

Sans un module facultatif, le Planning se charge quand même : ses éléments ne sont jamais proposés (le plan le dit), et `GET /summary` renvoie `features` (`youtubeVideo`, `instagramPack`, `customReels`) pour que l'interface cache ce qui en dépend. Sans `videoEngine`, la vidéo longue part avec la miniature automatique de YouTube.

## API

| Méthode | Route                                         | Rôle                                                                                                         |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET     | `/summary`                                    | Aujourd'hui, fuseau, compte, quota, message de file d'attente, erreurs du modèle                             |
| GET     | `/calendar?from=&to=`                         | Éléments d'une période (dates locales)                                                                       |
| GET     | `/today`                                      | À publier aujourd'hui, en retard, 7 prochains jours                                                          |
| GET     | `/tracks`                                     | Morceaux, avec vidéo, pack et sortie existante                                                               |
| POST    | `/plan`                                       | Proposition : `{ trackId, date, time, videoId? }` → éléments, décalages, avertissements                      |
| POST    | `/releases`                                   | Crée le plan (`items` : dates modifiées, facultatif)                                                         |
| GET     | `/releases` · `/releases/:id`                 | Sorties planifiées                                                                                           |
| PATCH   | `/releases/:id`                               | `{ videoId }` : autre vidéo générée                                                                          |
| DELETE  | `/releases/:id?online=keep\|delete`           | Retire le morceau du planning                                                                                |
| POST    | `/releases/:id/upload`                        | Envoie tous les éléments YouTube                                                                             |
| PATCH   | `/items/:id`                                  | `{ date?, time?, title?, description?, tags?, visibility?, resetTexts? }` (déjà programmé : `videos.update`) |
| POST    | `/items/:id/texts/template`                   | « Enregistrer comme modèle par défaut » (`{ title?, description? }`)                                         |
| GET     | `/releases/:id/custom-reels`                  | Reels perso à ajouter : jours autorisés, déjà planifiés, date proposée                                       |
| POST    | `/releases/:id/items`                         | Ajoute un Reel perso `{ customReelId, kinds: ['insta-reel', 'short'], date, time? }` (jour autorisé)         |
| PATCH   | `/items/:id/caption`                          | Instagram : `{ caption \| null }`, enregistrée dans le pack (`instagramPack.setCaption`)                     |
| POST    | `/items/:id/upload` · `/items/:id/cancel`     | Envoyer / annuler                                                                                            |
| POST    | `/items/:id/published`                        | Instagram : case « Publié » du pack                                                                          |
| POST    | `/items/:id/regenerate` · `/items/:id/reveal` | Régénérer le fichier / le montrer                                                                            |
| DELETE  | `/items/:id?online=keep\|delete`              | Retire l'élément                                                                                             |
| POST    | `/check-now`                                  | Relit le statut sur YouTube                                                                                  |
| GET     | `/account` · POST `/account/connect`          | Compte Google (chaîne) / connexion                                                                           |

## Code

| Fichier              | Contenu                                                         |
| -------------------- | --------------------------------------------------------------- |
| `backend/plan.ts`    | modèle, plan, anti-embouteillage, métadonnées (fonctions pures) |
| `backend/time.ts`    | fuseaux et changements d'heure, jour de quota                   |
| `backend/quota.ts`   | file d'attente du quota                                         |
| `backend/status.ts`  | machine à états                                                 |
| `backend/youtube.ts` | client de l'API, upload résumable                               |

Tests : unitaires (`tests/plan.test.ts`), client contre un faux serveur (`tests/youtube-client.test.ts`), module complet avec faux Google (`tests/release-planner.test.ts`, `tests/mock-google.ts`).
