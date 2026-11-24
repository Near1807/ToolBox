# 0054 — Socle : dossier externe servi aux lecteurs, copie cohérente de la base, indicateur dans la barre latérale

- Statut : acceptée (v0.46.0)
- Date : 23/11/2026
- Référence : ADR 0051 (fichiers de l'utilisateur gardés par un module), ADR 0055 (disque du Coffre)

## Contexte

Le Coffre garde une copie de tout sur un disque externe (v0.46). Trois besoins dépassent le module, et la règle d'or veut qu'il passe par des API génériques du socle, jamais par un accès direct :

1. lire un élément **archivé** (présent seulement sur le disque) avec les lecteurs de ToolBox, alors que `mediaUrl` ne sert que les dossiers de ToolBox ;
2. donner au disque une **copie cohérente de la base** (le disque doit se suffire à lui-même), alors qu'un module ne voit pas la connexion SQLite ;
3. montrer l'état du disque **d'un coup d'œil** dans la barre latérale, qui ne connaît aucun module.

## Décision

1. `ctx.files.allowMediaRoot(dir)` (PC) : un module laisse `mediaUrl` servir un dossier **choisi par l'utilisateur** hors de ToolBox, et le retire quand il disparaît (disque débranché). Les racines restent vérifiées à la signature et à la lecture (`MediaSigner`), par module.
2. `ctx.db.snapshotTo(file)` (PC) : `VACUUM INTO` vers un chemin absolu, c'est-à-dire la copie de SQLite elle-même, cohérente même pendant l'écriture. Le module écrit sous un nom temporaire puis renomme.
3. `nav.badge` (frontend) : un petit composant du module au bout de son entrée, rendu dans son contexte, isolé par une `ErrorBoundary` silencieuse.

Les deux premières API sont **facultatives** dans le contrat (`?`) : l'hôte du téléphone ne change pas.

## Conséquences

- Aucun module n'importe la base ni le serveur de fichiers ; le socle ne connaît pas le Coffre.
- La copie de la base contient les données de **tous** les modules : elle va sur un disque que Thomas a choisi. Les jetons OAuth y restent chiffrés par Windows (inutilisables ailleurs).
- MODULES.md §5.1, §5.2 et §7.8.
