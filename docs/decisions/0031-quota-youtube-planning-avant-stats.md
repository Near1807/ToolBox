# 0031 — Quota YouTube partagé : le Planning passe avant les Stats

- Statut : acceptée
- Date : 2026-10-23

## Contexte

Le Planning de sortie (envois et programmation YouTube) et Stats YouTube (synchronisation) utilisent le même projet Google Cloud : ils partagent le quota quotidien de l'API YouTube Data (10 000 unités par défaut, remis à zéro à minuit, heure de Californie). L'API YouTube Analytics a son propre quota. Une synchronisation des stats ne doit jamais empêcher un envoi prévu.

## Décision

- **Le Planning tient le compte du quota du jour** : ses propres envois et unités, et celles des autres modules (migration 4 : `release_planner__quota_shared`, par jour et par module, avec qui a reçu « quota dépassé » en premier). Les unités des autres modules comptent dans ses limites d'envoi.
- **Service `releasePlanner`** étendu : `youtubeQuota()` (consommation par module, envois en cours, envois dans les 24 h dont ceux que l'envoi automatique va lancer), `recordYouTubeQuota(module, unités, épuisé?)`, `quotaOrigin()` (phrase qui dit qui a consommé quoi).
- **Stats YouTube s'efface** :
  - envois en cours ou en file → synchronisation reportée, sans aucun appel à Google ; nouvel essai à la tâche planifiée suivante (30 min) ;
  - envois prévus dans les 24 h → synchronisation minimale (chaîne, liste des vidéos, jours de la chaîne ; le détail par vidéo attend) ;
  - **réserve** réglable (`quotaReserve`, 1 000 unités par défaut) jamais consommée : la synchronisation s'arrête avant d'y toucher et le dit ;
  - chaque appel à l'API Data (1 unité) est déclaré au Planning.
- **Quota épuisé** : le message (Stats et Planning) dit qui l'a consommé (« Consommation du jour : 3 envoi(s) du Planning et 300 unité(s) pour leurs suites, 12 unité(s) pour Stats YouTube. Quota épuisé lors d'un appel de … »).
- Sans le Planning (module absent), Stats YouTube fonctionne comme avant (pas d'envois à protéger).

## Conséquences

- En pratique la synchronisation coûte quelques unités de l'API Data (l'essentiel passe par l'API Analytics) : la réserve et le report protègent surtout des cas extrêmes (autres applications sur le même projet, quota réduit par Google).
- Les unités consommées par d'autres applications sur le même projet Google ne sont pas visibles : seule la réponse « quota dépassé » de Google les révèle.
