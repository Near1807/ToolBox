# 0019 — Notifications Windows et démarrage dans la zone de notification

- Statut : acceptée (complète la roadmap « Démarrage avec Windows et icône dans la zone de notification »)
- Date : 2026-10-20

## Contexte

Les publications Instagram restent manuelles : il faut un rappel à l'heure prévue. Les tâches planifiées du hub (rappels, envois YouTube étalés par le quota, relevés futurs) ne tournent que si l'app est ouverte.

## Décision

- **`ctx.notifications.notify({ title, body, path })`** dans le socle : notification Windows via `HostAdapter.notify` (`Notification` d'Electron). Un clic ramène la fenêtre et ouvre la page du module (`/m/<id>/<path>`, IPC `toolbox:navigate` exposé par le preload sous la forme d'une route de l'interface uniquement). Chaque notification est aussi écrite dans les journaux du module. Le socle ne décide pas _quand_ notifier : les modules le font depuis leurs tâches planifiées.
- **Réglage du socle « Lancer ToolBox au démarrage de Windows »**, désactivé par défaut. Activé, il inscrit l'app au démarrage de la session (`setLoginItemSettings`, argument `--hidden`, seulement l'app installée). L'app démarre sans fenêtre, avec une icône dans la zone de notification (Ouvrir / Quitter). Fermer la fenêtre la réduit dans la zone tant que l'option est active.
- Au démarrage, le module concerné envoie **une** notification récapitulative de ce qui est dû ou en retard, plutôt qu'une par élément.

## Alternatives écartées

- **Service Windows / tâche planifiée Windows** séparé de l'app : un second programme à installer et à maintenir, pour un usage personnel.
- **Toujours garder l'app dans la zone de notification** : surprenant pour qui ferme l'app avec la croix sans avoir rien demandé.

## Conséquences

- Les rappels fonctionnent PC allumé et session ouverte. La publication YouTube programmée, elle, ne dépend pas du PC : YouTube publie seul.
- Quitter vraiment l'app quand l'option est active : clic droit sur l'icône › « Quitter ToolBox ».
