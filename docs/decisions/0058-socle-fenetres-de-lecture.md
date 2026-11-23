# 0058 — Socle : les fenêtres de lecture (une page de module dans sa propre fenêtre)

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/MODULES.md` §5.16, `docs/coffre/CAHIER-DES-CHARGES.md` (règle 9), ADR 0053

## Contexte

Thomas veut lire une synthèse ou un cours « en plein écran » **à côté** de VS Code ou d'un autre logiciel (Alt+Tab), éventuellement deux documents à la fois, sans l'interface de ToolBox. L'aperçu du Coffre est une couche par-dessus la page : il ne se met pas à côté d'une autre application.

## Décision

- **Socle, générique** : `ctx.ui.openWindow(route, { title })` ouvre une route **du module** (`/m/<id>/…`, toute autre est refusée) dans une nouvelle fenêtre du système (`HostAdapter.openWindow`, `electron/reader-windows.ts`). Une fenêtre par appel : plusieurs à la fois.
- La fenêtre charge `#/w/m/<id>/…` : la même application, la même session, une mise en page sans barre latérale ni recherche ni « Ajouter » (`WindowLayout`), le thème de l'app. Le module y rend sa propre page : **aucun code d'affichage dupliqué** (le Coffre y met `ReaderView`, ses lecteurs, en mode `window`).
- Mêmes protections que la fenêtre principale : preload identique, `sandbox`, `contextIsolation`, aucune navigation hors de l'app, liens externes vers le navigateur par défaut. L'isolation du HTML du Coffre est la même (cadre `sandbox=""`, politique `default-src 'none'`).
- **F11** : plein écran de cette fenêtre seulement (le choix de la fenêtre principale n'est pas changé). Fermeture par le bouton de la fenêtre ; **Échap ne ferme rien**.
- **Place et taille** : la dernière place donnée par Thomas (déplacée, redimensionnée, agrandie) est retenue dans `<userData>/reader-window.json` ; une fenêtre ouverte puis fermée sans être bougée ne la change pas ; décalage de 32 px par fenêtre déjà ouverte ; ramenée sur un écran existant.
- Les fenêtres de lecture se ferment avec la fenêtre principale.
- Sans app de bureau (tests, navigateur de développement) : `openWindow` renvoie `false` ; la page du Coffre ouvre alors un onglet.

## Conséquences

- Le Coffre : « Lire en plein écran » dans l'aperçu, sur la carte et dans le clic droit ; PDF (pages, zoom, recherche dans le document, aller à la page), code (numéros de ligne, « Ouvrir dans VS Code »), Markdown (sommaire latéral), images (zoom), archivé lu depuis le disque.
- Un autre module peut ouvrir une de ses pages de la même façon.
- F11 n'a pas pu être vérifié sous l'écran virtuel Linux (pas de gestionnaire de fenêtres) : même code que la fenêtre principale ; à vérifier sur le PC.
