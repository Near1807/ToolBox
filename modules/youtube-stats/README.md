# Stats YouTube (`youtube-stats`)

Toutes les statistiques de la chaîne au même endroit, **croisées avec ce que l'app sait** : morceau source, Short n, Reel perso, extrait utilisé, effet, intensité, mode de son, date et heure de publication, forme d'onde. Esprit « geek » mais lisible : quatre niveaux de profondeur, et un **niveau de confiance affiché partout** (🎲 Intuition, 🔎 Piste, 🧱 Solide).

## Ce qu'il fait

Page à onglets (`?tab=`) :

1. **Vue d'ensemble** : abonnés, vues, heures regardées, abonnés nets, % moyen regardé, part des Shorts (chacun comparé à la période précédente) ; courbe des vues par jour (Shorts / vidéos longues, publications marquées) ; abonnés ; top morceaux ; « Depuis ta dernière visite » ; records et jalons ; 3 faits marquants.
2. **Morceaux** : vues cumulées par morceau (tous ses Shorts et sa vidéo), répartition Shorts / vidéo, frise de la sortie (lundi → vendredi) posée sur les vues.
3. **Vidéos** : liste filtrable ; fiche complète : courbe des vues, indice « ×1,8 par rapport à d'habitude » à J+1/3/7/30, rétention sur la forme d'onde, sources de trafic, pays, appareils, lieux de lecture, âge et genre, vidéos qui y mènent, impressions et taux de clics (si disponibles).
4. **Labo** : rétention × musique (énergie, sections Intro/Montée/Drop/Pause/Outro, décrochages et re-visionnages), performance relative J+1/3/7/30 (courbes normalisées), effet « rabatteur » des Shorts sur la vidéo longue (corrélation décalée + trafic Shorts → vidéo), meilleurs extraits, comparaison des styles (effet, intensité, mode de son, Reel de la cover vs Reel perso), carte jour × heure, conversion en abonnés, cycle de vie (vitesse de départ, demi-vie, « evergreen »), anomalies annotées des publications voisines.
5. **Théories** : hypothèses en clair avec données, effectif, test et niveau de confiance, suggestion d'expérience ; journal dans le temps (confirmée / infirmée / en attente) avec l'historique.
6. **Données** : connexion, « Synchroniser maintenant », état de la dernière synchro, import CSV, liaisons vidéo ↔ morceau.

Widget d'accueil : abonnés, vues sur 28 jours et le premier fait marquant.

### Niveaux de confiance

Comparaisons de groupes : Mann-Whitney + intervalle bootstrap de la différence (ou du rapport) des médianes ; corrélations : Spearman avec p par permutation et intervalle bootstrap ; correction de Holm par famille de tests.

- 🎲 **Intuition** : moins de 4 vidéos par groupe, ou p ≥ 0,2. Affiché, mais présenté comme une idée à tester.
- 🔎 **Piste** : p < 0,2, ou l'intervalle inclut encore l'absence d'effet, ou moins de 8 vidéos par groupe.
- 🧱 **Solide** : ≥ 8 par groupe, p < 0,05 (après Holm), intervalle qui exclut l'absence d'effet, effet net (rapport ≥ 1,2 ou |ρ| ≥ 0,3).

Journal : « confirmée » après deux évaluations Solide de suite dans le même sens ; « infirmée » si le sens s'inverse (≥ Piste) ou si l'effet disparaît trois évaluations de suite. Une évaluation par jour au plus. À la première évaluation, l'historique est recalculé « a posteriori » sur les données tronquées tous les 60 jours (marqué comme tel).

### Liaison vidéo ↔ morceau

- **Automatique** par le Planning de sortie (service `releasePlanner`) : vidéo longue, Short n, origine (Reel de la cover, Reel perso), extrait (`startSec`), effet, intensité, mode de son, date programmée.
- **Manuelle** (onglet Données) pour les vidéos hors Planning, avec une suggestion par ressemblance du titre. Une liaison manuelle prime sur le Planning.

### Mode démo

Réglage « Mode démo » : chaîne simulée déterministe (environ 8 mois de sorties), bandeau **« DONNÉES DE DÉMO »** sur chaque page. Rien n'est écrit en base, rien n'est mélangé aux vraies données. Effets plantés exprès (pour vérifier que les théories les retrouvent) : mardi ×2,2, effet Rythme ×1,35 et +9 points de rétention, énergie → rétention, la vidéo longue reçoit 6 % des vues de la veille des Shorts, un morceau « evergreen », un pic isolé, une vidéo non liée.

## Métriques disponibles (API YouTube Analytics v2)

| Rapport                               | Dimensions                                                                         | Métriques                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chaîne par jour                       | `day`                                                                              | `views`, `estimatedMinutesWatched`, `likes`, `comments`, `shares`, `subscribersGained`, `subscribersLost`                                                                                        |
| Vidéo par jour                        | `day` + `video==id`                                                                | idem + `averageViewDuration`, `averageViewPercentage` ; `engagedViews` si l'API l'accepte (sinon retiré automatiquement)                                                                         |
| Portée (tentée)                       | `day` + `video==id`                                                                | `videoThumbnailImpressions`, `videoThumbnailImpressionsClickRate` — **non confirmé** : si Google refuse (400), « non disponible » est mémorisé et l'import CSV de YouTube Studio prend le relais |
| Rétention                             | `elapsedVideoTimeRatio` (100 points) + `video==id`                                 | `audienceWatchRatio`, `relativeRetentionPerformance`                                                                                                                                             |
| Type de contenu                       | `creatorContentType`                                                               | `views` (sert à classer Short / vidéo longue)                                                                                                                                                    |
| Répartitions par vidéo et pour chaîne | `insightTrafficSourceType`, `country`, `deviceType`, `insightPlaybackLocationType` | `views`, `estimatedMinutesWatched`                                                                                                                                                               |
| Démographie                           | `ageGroup`, `gender`                                                               | `viewerPercentage`                                                                                                                                                                               |
| Vidéos qui y mènent                   | `insightTrafficSourceDetail` (filtre `insightTrafficSourceType==RELATED_VIDEO`)    | `views`                                                                                                                                                                                          |

API YouTube Data v3 (lecture) : `channels` (chaîne, playlist des uploads, abonnés), `playlistItems`, `videos` (titre, durée, date, statut).

### Limites de l'API (à connaître)

- **Retard** : les chiffres arrivent avec 2 à 3 jours de retard (48–72 h) ; la synchro va jusqu'à « hier » et relit les 5 derniers jours à chaque passage (les chiffres récents bougent encore).
- **Jours** : les jours de l'API sont ceux du Pacifique (heure de Los Angeles), pas de Bruxelles.
- **Seuils de confidentialité** : âge, genre, pays et sources sont masqués par Google sous un certain volume (officieusement ~100 vues) ; l'interface dit « pas assez de vues pour que YouTube les donne ».
- **Rétention** : une seule vidéo par requête ; d'où un rafraîchissement tous les `detailsEveryDays` jours seulement.
- **Quotas** : Analytics (quota propre, généreux) ; Data API 10 000 unités par jour partagées avec l'envoi des vidéos du Planning (une synchro complète coûte quelques unités par tranche de 50 vidéos). Quota dépassé → synchro arrêtée proprement, message clair qui dit qui a consommé le quota (envois du Planning, stats), reprise à la suivante. **Le Planning passe avant** (ADR 0031) : envois en cours → synchro reportée (nouvel essai 30 min plus tard) ; envois prévus dans les 24 h (envoi automatique compris) → synchro minimale (chaîne, liste des vidéos, jours de la chaîne) ; une **réserve** réglable (`quotaReserve`, 1 000 unités) n'est jamais consommée. Chaque appel à l'API Data est compté dans le quota du Planning (`recordYouTubeQuota`).
- **Abonnés dans le passé** : l'API ne donne que le total actuel ; l'historique est reconstruit à rebours avec les gains / pertes par jour (approximation), puis un relevé réel par jour (`snapshots`).
- **Impressions / CTR** : voir ci-dessus ; l'export CSV de Studio reste la source sûre.

## Deux sources, toujours dites

- **En direct (estimé)** : compteurs de l'API YouTube Data (abonnés, vues totales, j'aime, commentaires), relus à chaque synchronisation. La Vue d'ensemble les affiche en tête, comme sur la chaîne.
- **Consolidé** : statistiques jour par jour de l'API YouTube Analytics, publiées par YouTube avec 2 à 3 jours de retard. Courbes, périodes, Labo et théories ne voient que celles-ci ; la date limite est affichée (« données disponibles jusqu'au JJ/MM » = le dernier jour que YouTube a donné pour la chaîne, jamais aujourd'hui ; 3 jours avant aujourd'hui tant qu'aucune synchro n'a eu lieu).

La source de chaque nombre s'affiche au survol (tuiles et courbes de la fiche vidéo).

## Import CSV de YouTube Studio

YouTube Studio › Statistiques › « Mode avancé » › Exporter (CSV ou .zip, en français ou en anglais). Onglet **Données › Importer un export** : les colonnes sont reconnues automatiquement (synonymes FR/EN : « Impressions », « Taux de clics des impressions (%) », « Vues », « Durée de visionnage (heures) »…), les lignes « Total » ignorées. Export **par jour** (dimension Date) ou **totaux par vidéo** (dimension Contenu).

**Priorité, par métrique et par jour** : un CSV ne fournit **que les impressions et le taux de clics**, et seulement là où l'API n'en donne pas ; une valeur de l'API n'est jamais remplacée par celle d'un CSV, et l'API remplace une valeur CSV dès qu'elle en donne une. Les vues, durées, j'aime… viennent toujours de l'API. Totaux d'impressions d'une vidéo : jours de l'API, sinon export « totaux » (figé à sa date), sinon jours d'un CSV.

**Chaque import est listé** (date, fichier, période, lignes reconnues, jours encore en usage, métriques) avec **« Supprimer cet import »** : la confirmation dit exactement ce qui part (impressions et taux de clics de N jours-vidéo, totaux de N vidéos ; jamais une donnée de l'API), une sauvegarde de la base est faite juste avant (`ctx.db.backup`), puis les vues sont recalculées. Les imports faits avant la v0.18 sont repérés par la migration 2 (« importé avant la v0.18 ») ; quand leurs données ne peuvent pas être rattachées avec certitude à un import (plusieurs imports, ou API et CSV mêlés), **« Supprimer toutes les données CSV »** les retire toutes plutôt que deviner.

## Diagnostic et résumé de synchro

- **Bouton « Lancer le diagnostic »** (onglet Données, lecture seule, 1 unité de quota YouTube Data) : mode démo, identifiants Google, compte connecté, jeton expiré ou révoqué, autorisation des stats, API Data et API Analytics (activée ? réseau ?), retard de YouTube (jusqu'à quelle date il a des données), priorité aux envois (synchro reportée ou minimale, et pourquoi), quota et réserve, dernière synchronisation, synchro automatique, imports CSV, réparation en attente. Chaque point : OK, ou le problème et l'action.
- **Après chaque synchronisation** : ce qui a été demandé (période, vidéos), reçu (jours, lignes nouvelles ou modifiées), la dernière date disponible ou « Aucune donnée consolidée nouvelle depuis le JJ/MM (retard normal de YouTube) », la durée et le nombre de requêtes. Le détail par étape (`durations`) est dans le résumé enregistré (`lastSync.summary`).
- La page se recharge seule à la fin d'une synchronisation (avant : elle gardait les chiffres d'avant jusqu'à sa réouverture).
- Les statistiques par vidéo sont demandées 4 à la fois (avant : une après l'autre, plusieurs minutes pour une centaine de vidéos).

## Connexion

Réutilise le compte Google de `ctx.accounts` (le même que le Planning). « Autoriser les statistiques » demande **en plus** les autorisations en lecture seule `yt-analytics.readonly` et `youtube.readonly` (cumulées, `include_granted_scopes`) : pas besoin de tout reconnecter. Dans Google Cloud, activer **« YouTube Analytics API »** sur le même projet que la « YouTube Data API v3 ». Jeton expiré / révoqué → « Reconnecter » ; API non activée → message qui le dit.

## Données

| Élément        | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables         | `youtube_stats__videos` (vidéo, type, durée, publication, liaison manuelle, dates des derniers détails) · `__days` (vidéo × jour : vues, vues engagées, minutes, durée et % moyens, j'aime, commentaires, partages, abonnés +/-, impressions, CTR ; `api_at` = écrit par l'API, `reach_source` `api`/`csv`/`unknown` + `import_id` pour les impressions) · `__channel_days` · `__snapshots` (relevé quotidien des totaux) · `__breakdowns` (vidéo ou chaîne × type × clé) · `__retention` · `__waveforms` (forme d'onde par morceau, cache) · `__imports` (fichier, période, métriques, jours en usage, `legacy`) · `__journal` · `__meta` — migration 1 ; migration 2 (v0.18) : provenance des nombres, imports d'avant repérés, réparation des jours qu'un CSV faisait passer pour connus (`fullResync`) |
| Fichiers       | aucun (pas de `ctx.outputs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Réglages       | `demoMode` (non), `syncHours` (1–48, 6), `detailsEveryDays` (1–30, 7), `quotaReserve` (0–9 000, 1 000), `timeZone` (`Europe/Brussels`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tâche          | `sync` (progression et annulation dans Tâches)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Planificateur  | `auto-sync` toutes les 30 min : synchronise si la dernière synchro a plus de `syncHours` heures (donc aussi au démarrage, avec rattrapage)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Service fourni | aucun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Assistant      | `channel-summary` (7, 28 ou 90 jours), `track-stats`, `highlights` en lecture, « Données de démo » annoncé en mode démo ; `sync` (lance la synchronisation, modification derrière le droit `youtube-stats.sync`, désactivé par défaut) ; phrases d'exemple et extracteurs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Dépendances

Aucune obligatoire. Facultatives (`ctx.services.optional()`) : `musicLibrary` (titres, covers, audio pour la forme d'onde), `releasePlanner` (liaison automatique), `instagramPack` (extrait, Reel de la cover), `customReels` (effet, intensité, mode de son), `videoEngine` (forme d'onde / énergie). Sans elles, le module affiche les stats brutes, sans croisement.

## API

| Méthode | Route                                          | Rôle                                                                                   |
| ------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| POST    | `/account/connect`                             | Demande les autorisations de lecture des stats                                         |
| POST    | `/sync`                                        | « Synchroniser maintenant » (tâche `sync`)                                             |
| GET     | `/state`                                       | Compte, chaîne, dernière synchro, synchro en cours, portée, imports, services présents |
| GET     | `/overview?period=&kind=`                      | Vue d'ensemble                                                                         |
| POST    | `/visit`                                       | Note la visite (« Depuis ta dernière visite »)                                         |
| GET     | `/tracks` · `/tracks/:id`                      | Morceaux · détail et frise de sortie                                                   |
| GET     | `/videos?period=&kind=&track=` · `/videos/:id` | Vidéos · fiche                                                                         |
| GET     | `/lab` · `/theories`                           | Labo · théories et journal                                                             |
| GET     | `/links` · PUT `/videos/:id/link`              | Liaisons · lier `{ trackId \| null }`                                                  |
| POST    | `/import` · GET `/imports`                     | Import d'un export Studio `{ path }` · liste des imports et données non rattachables   |
| GET     | `/imports/:id/footprint`                       | Ce que la suppression retirerait (`:id` ou `all`)                                      |
| DELETE  | `/imports/:id` · `/imports/all`                | Supprime un import (ou toutes les données CSV), après sauvegarde de la base            |
| POST    | `/diagnostic`                                  | Vérifie chaque cause possible (lecture seule)                                          |

Toutes les réponses portent `mode: 'real' | 'demo'`. Pour les tests, `TOOLBOX_YT_ANALYTICS_URL` remplace l'adresse de l'API Analytics.

## Tests

`tests/stats.test.ts` (méthodes statistiques), `tests/analysis.test.ts` (musique, Labo et théories sur la démo, journal, CSV dont .zip, liaison par titre, fuseaux), `tests/sync.test.ts` (faux Google : autorisations cumulées, synchro et liaison, re-synchro incrémentale, import CSV, liaison manuelle, quota avec son origine, envois du Planning d'abord (synchro reportée ou minimale), réserve jamais consommée, jeton expiré, démo séparée, résumé de synchro et « aucune donnée nouvelle », en direct / consolidé, CSV qui ne masque pas l'API ni ne fait sauter de jours, suppression d'un import, chaque cause du diagnostic), `tests/provenance.test.ts` (migration 2 sur des données de la v0.17 : imports attribuables ou non, priorité API > CSV, suppression sans toucher l'API). Tous rapides (pas de rendu).
