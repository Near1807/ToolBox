# 0028 — Actions des modules pour l'assistant, touche globale, indicateur flottant

- Statut : acceptée
- Date : 2026-10-23

## Contexte

L'assistant vocal (V1) doit agir sur les autres outils (ajouter une tâche, dire ce qu'il faut publier aujourd'hui, ouvrir une page) sans que le socle ni l'assistant connaissent chaque module (règle d'or : le socle reste générique). Il doit être sûr : un modèle de langue local peut se tromper, inventer un paramètre ou « décider » tout seul de supprimer. Il faut aussi parler en maintenant une touche (talkie-walkie), même quand ToolBox n'a pas le focus, et voir l'état de l'assistant app réduite.

## Décision

- **Règle du contrat : chaque module expose ses actions** (`ctx.assistant.define`). Une action = nom, description française, paramètres typés, **niveau de risque**, et `run`. L'assistant les découvre : il n'a aucun code propre aux autres modules.
- **Le socle, pas l'assistant, applique les risques** : `read` et `change` s'exécutent directement (une modification fournit `undo`, gardé en mémoire 1 h pour « Annuler ») ; `destructive` n'est jamais exécutée sans `confirmed`, et le module fournit la question à poser ; `sensitive` (publier, envoyer sur YouTube, supprimer des fichiers, changer une date programmée) **n'a pas de `run`** : refus, avec la page où le faire soi-même. Un module consommateur doit déclarer `permissions.assistant`.
- **Paramètres vérifiés par le socle** (sous-ensemble de JSON Schema, avec les corrections usuelles : nombre en texte, liste « a, b »). Un paramètre inconnu ou manquant est refusé avec un message que le modèle peut relayer ou corriger.
- **Touche globale** : `uiohook-napi` (libuiohook, binaires N-API précompilés pour Windows x64, comme better-sqlite3 et @napi-rs/canvas : aucune recompilation). `globalShortcut` d'Electron ne voit que l'appui, pas le relâchement, donc pas de « maintenir pour parler ». Le crochet ne tourne que si un module écoute ; seul le code de la touche choisie est comparé ; rien n'est enregistré ni journalisé. Permission `permissions.globalKeys`.
- **Touche Copilot** : elle envoie Win+Maj+F23 (choix de Microsoft). Le crochet voit F23. Deux limites, hors de portée d'une app non empaquetée MSIX :
  - Windows ouvre aussi Copilot (ou la Recherche). Le réglage « Personnaliser la touche Copilot » n'accepte que des apps MSIX signées.
  - Sur certains PC, le relâchement est envoyé tout de suite, si bien qu'on ne peut pas maintenir la touche.
    L'assistant gère donc les deux gestes (maintenir, ou appuyer une fois pour commencer et une fois pour finir) et documente les solutions : PowerToys « Remapper un raccourci » Win+Maj+F23 → F24, ou une autre touche.
- **Indicateur flottant** : fenêtre Electron transparente, toujours au premier plan, sans focus ni souris, qui affiche la route `#/overlay` (composants `Overlay` des modules), montrée à la demande (`ctx.ui.setOverlay`). **Composants `Background`** montés une fois dans la fenêtre principale (micro, lecture audio) ; la fenêtre ne ralentit plus en arrière-plan.
- **Permissions de l'interface** : jusqu'ici Electron accordait tout par défaut. Désormais seulement les pages de l'app, et parmi les périphériques le micro uniquement.

## Conséquences

- Tout nouveau module déclare ses actions (MODULES.md §5.15, checklist, modèle `_template`).
- Les annulations ne survivent pas à la fermeture de l'app (comme la conversation).
- Une nouvelle dépendance native (`uiohook-napi`) : vérifiée par `npm run check:native` (sous Linux, avec un écran : `xvfb-run -a`).
- Touche Copilot : non testée en réel (pas de PC avec cette touche ici) ; à vérifier chez Thomas.
