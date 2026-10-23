# 0027 — Stats YouTube : données locales, niveaux de confiance, démo, CSV en repli

- Statut : acceptée
- Date : 2026-10-23

## Contexte

Thomas veut toutes ses statistiques YouTube au même endroit et, surtout, les croiser avec ce que l'app sait (morceau, Short n, extrait, effet, mode de son, date de publication, forme d'onde) pour aller plus loin que YouTube Studio. Sa chaîne est petite : beaucoup de comparaisons porteront sur quelques vidéos, où le hasard domine.

## Décision

- **Module séparé `youtube-stats`**, sans dépendance obligatoire : Bibliothèque, Planning, Pack Insta, Reels perso et moteur vidéo sont des services facultatifs (ADR 0024). Sans eux : stats brutes, sans croisement.
- **Données copiées en local** (tables `youtube_stats__*`) : historique gardé même si l'API ne le redonne plus, calculs sans réseau, synchro incrémentale (5 derniers jours relus, rétention et répartitions tous les N jours). Abonnés passés reconstruits à rebours, puis relevé réel quotidien.
- **Compte** : le compte Google de `ctx.accounts`, avec en plus `yt-analytics.readonly` et `youtube.readonly` (autorisations cumulées, pas de reconnexion complète).
- **Liaison** par le nouveau service `releasePlanner` (`listYouTubeItems`) : chaque vidéo programmée par le Planning est reliée à son morceau et à sa source. Le Planning reste propriétaire de ses données. Liaison manuelle en plus, avec suggestion par titre.
- **Impressions et taux de clics** : tentés dans l'API (documentation contradictoire) ; au premier refus, « non disponible » est mémorisé et l'import de l'export CSV de Studio prend le relais (colonnes reconnues par synonymes FR/EN).
- **Honnêteté statistique** : méthodes pour petits effectifs, sans hypothèse de loi (Mann-Whitney, Spearman par permutation, bootstrap, Holm par famille). Trois niveaux affichés partout : Intuition (< 4 par groupe ou p ≥ 0,2), Piste, Solide (≥ 8 par groupe, p < 0,05, intervalle hors de l'absence d'effet, effet net). Une phrase dit toujours pourquoi. Jamais de certitude sur peu de données.
- **Journal des théories** : une évaluation par jour au plus ; confirmée (deux Solide de suite, même sens), infirmée (sens inversé, ou effet disparu trois fois de suite). Premier historique recalculé a posteriori, signalé comme tel.
- **Mode démo** : jeu de données déterministe généré à la volée, jamais stocké, avec des effets plantés connus ; bandeau « DONNÉES DE DÉMO » partout. Il sert aussi de test : les théories doivent retrouver les effets plantés.
- **Graphiques** dessinés en SVG dans le module (pas de bibliothèque), couleurs des thèmes (`--series-*`), Shorts / vidéos longues distingués aussi par le tracé (pointillés) et la légende.

## Conséquences

- Aucun test sur une vraie chaîne (pas de compte dans l'environnement de développement) : synchro testée contre un faux Google (données, quota, jeton expiré, autorisations manquantes).
- Seuils de confiance choisis a priori, à revoir avec de vraies données.
- Les graphiques ne sont pas dans le SDK : à remonter si un autre module de stats arrive (`instagram-stats`, `soundcloud-stats`).
- Le quota de la Data API est partagé avec l'envoi des vidéos du Planning ; la synchro en consomme peu.
