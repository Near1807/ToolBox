# 0033 — Stats YouTube : deux sources dites, l'API avant le CSV, imports supprimables

- Statut : acceptée
- Date : 2026-10-24

## Contexte

Tests réels de Thomas (v0.17) : chiffres différents de YouTube ; « Synchroniser » tourne ~5 minutes, dit « terminé », rien ne change ; après un import CSV de Studio, les chiffres semblent figés à la date de l'export. Causes trouvées dans le code :

1. **Un import CSV faisait sauter des jours à la synchro.** Les lignes créées par un CSV (impressions seules) avaient `views = 0` (valeur par défaut de la colonne) : `lastDayOf` (« dernier jour connu », `views IS NOT NULL`) les comptait. Un export qui va jusqu'à sa date faisait croire à la synchro que tous les jours jusque-là étaient connus : elle ne redemandait que les 5 derniers jours avant cette date. Les jours manquants restaient à 0 vue, pour toujours.
2. **Les totaux d'un CSV passaient avant l'API.** Fiche vidéo : `video.impressions` (export « totaux », figé) était pris avant la somme des jours de l'API. Et un CSV importé après coup écrasait les impressions données par l'API.
3. **La page ne se rechargeait pas à la fin d'une synchro** : elle gardait les chiffres d'avant jusqu'à sa réouverture.
4. **Les vues de la période étaient des données consolidées** (2–3 jours de retard, et date limite fixe à J-3) affichées sans le dire, à côté de YouTube qui montre des compteurs en direct.
5. **Lenteur** : chaque vidéo demandait ses statistiques une après l'autre (jours, impressions, répartitions et rétention tous les 7 jours) : quelques centaines de requêtes en série pour une centaine de vidéos.

## Décision

- **Provenance de chaque nombre** (migration 2) : `api_at` sur chaque jour écrit par l'API (seuls ces jours comptent pour « dernier jour connu ») ; `reach_source` (`api`, `csv`, `unknown`) et `import_id` pour les impressions et le taux de clics.
- **Priorité par métrique et par jour** : l'API d'abord. Un CSV ne fournit que les impressions et le taux de clics, et seulement là où l'API n'en a pas ; il n'écrase jamais une valeur de l'API, l'API remplace une valeur CSV.
- **Deux sources affichées** : « en direct (estimé) » (API Data, à la dernière synchro) pour la vue d'ensemble ; « consolidé » (API Analytics) pour courbes, Labo et théories, avec « données disponibles jusqu'au JJ/MM » = le dernier jour donné par YouTube pour la chaîne (plus J-3 fixe).
- **Imports listés et supprimables un par un** : confirmation qui dit exactement ce qui part, sauvegarde de la base avant (nouveau `ctx.db.backup(reason)` du SDK), seules les données de cet import partent. Imports d'avant la v0.18 : la migration les repère et rattache leurs données **seulement quand c'est certain** (un seul import par jour et l'API n'a jamais donné d'impressions ; un seul import « totaux ») ; sinon, « Supprimer toutes les données CSV » plutôt que deviner.
- **Réparation** : si des lignes créées par un CSV existent, la prochaine synchronisation reprend tout l'historique (méta `fullResync`), une fois.
- **Diagnostic** (bouton, lecture seule) et **résumé après chaque synchro** (demandé, reçu, modifié, dernière date, « aucune donnée consolidée nouvelle depuis le JJ/MM », durée par étape).
- **Requêtes par vidéo 4 à la fois** (la première seule, pour savoir quelles métriques facultatives Google accepte). Une erreur arrête les autres proprement avant la réponse.

## Conséquences

- Les données existantes ne sont pas supprimées par la migration (colonnes ajoutées, étiquettes posées). La première synchro après la mise à jour peut être plus longue (tout l'historique) quand un CSV avait créé des lignes.
- « Données disponibles jusqu'au » peut avancer jusqu'à J-1 : un jour très récent peut encore être revu par YouTube ; la synchro redemande toujours les 5 derniers jours.
- 4 requêtes simultanées restent loin des limites de débit de l'API Analytics ; la consommation de quota est la même.
