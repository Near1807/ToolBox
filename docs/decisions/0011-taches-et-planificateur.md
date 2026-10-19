# 0011 — Tâches longues et planificateur dans le process

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Les rendus vidéo durent plusieurs minutes et doivent montrer leur progression et pouvoir être annulés. Les statistiques YouTube demandent un relevé quotidien, alors que l'app n'est pas forcément ouverte à l'heure prévue.

## Décision

- **Tâches longues** (`ctx.jobs`) : file FIFO par type de tâche dans le process principal, `concurrency` 1 par défaut, annulation par `AbortSignal`, progression enregistrée au plus toutes les 250 ms et diffusée par SSE (`/api/core/jobs/stream`). Le travail lourd lui-même tourne dans des process enfants (FFmpeg). Historique dans `core__jobs` (200 dernières). Pas de reprise automatique après fermeture : la tâche est marquée « interrompue » et l'utilisateur la relance.
- **Planificateur** (`ctx.scheduler`) : `daily` (heure locale) ou `everyMinutes`. État (`dernière réussite`, `dernier essai`) dans `core__schedules`. Une tâche est due si elle n'a jamais réussi ou si sa prochaine échéance (calculée depuis la dernière réussite) est passée : cela couvre le **rattrapage** au démarrage. Nouvel essai 15 min après un échec. Vérification chaque minute.
- Alternatives écartées : file persistante avec reprise (complexité sans gain pour des rendus qu'on peut relancer), planificateur système Windows (installation, droits, hors de l'app).

## Conséquences

- Les tâches planifiées ne tournent que lorsque l'app est ouverte ; le démarrage avec Windows est prévu dans la feuille de route. Les modules doivent tolérer des trous (ex. `youtube-stats` recalcule les jours manqués via l'API Analytics, grâce à `task.lastSuccessAt`).
