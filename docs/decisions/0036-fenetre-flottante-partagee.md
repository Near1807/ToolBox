# 0036 — Une seule fenêtre flottante, partagée, à panneaux empilés

- Statut : acceptée
- Date : 2026-10-24

## Contexte

Thomas travaille dans FL Studio, ToolBox réduite. Plusieurs éléments doivent apparaître par-dessus l'application en cours : l'indicateur du micro (assistant), le mini-timer, la barre de commande écrite de l'assistant, la question « Tâche terminée ? » du Timer et ses changements de phase. Jusqu'ici l'indicateur flottant (ADR 0028) était une fenêtre fixe de 360 × 96, en ligne, qui ne prenait ni la souris ni le clavier : impossible d'y cliquer « Oui, la cocher » ou d'y taper une commande, et deux éléments se serraient dans la même bande.

## Décision

- **Une seule fenêtre flottante dans le socle** (`electron/overlay.ts`), toujours au premier plan, fond transparent, en bas au centre de l'écran principal (au-dessus de la barre des tâches). Pas une fenêtre par module : rien ne peut se chevaucher.
- **Panneaux empilés** : la page `#/overlay` du shell rend le composant `Overlay` de chaque module, en colonne ; chaque élément est un `FloatingPanel` (SDK, composant partagé). La page mesure son contenu et la fenêtre prend exactement cette taille (bord bas fixe, elle grandit vers le haut ; 560 × 640 au plus, valeurs vérifiées par le process principal).
- **Souris et clavier seulement quand il le faut** : par défaut la fenêtre laisse passer les clics et ne prend jamais le focus. Un panneau `interactive` (boutons) lui fait prendre la souris **sans l'activer** (l'application en cours garde le clavier). Un panneau `focus` (champ de texte : la barre écrite) lui fait prendre le clavier, jusqu'à sa disparition ; la fenêtre est alors cachée puis remontrée sans activation, ce qui rend le clavier à l'application d'en dessous.
- **Visibilité inchangée** : un module la demande avec `ctx.ui.setOverlay(visible)` (le socle compte les demandes de tous les modules). Rien n'agit depuis la fenêtre sans clic : elle affiche et propose, les actions restent celles des pages (mêmes routes, mêmes règles).

## Conséquences

- Les modules n'ont rien à gérer de la fenêtre : ils rendent des `FloatingPanel` et disent s'ils ont des boutons ou un champ.
- Sur la zone des panneaux interactifs, les clics vont à ToolBox ; ailleurs ils passent à l'application en dessous.
- La fenêtre reste affichée (1 × 1 pixel transparent) tant qu'un module la demande, même vide : une fenêtre cachée peut ne plus calculer sa mise en page.
- Non vérifiable dans le conteneur Linux : le comportement exact du focus sous Windows (retour du clavier à FL Studio) est à confirmer sur le PC de Thomas.

## Révision (v0.22)

- Chaque panneau a sa propre durée de vie (`FloatingPanel` : `lifetimeMs`, `contentKey`) : la dernière réponse de l'assistant restait au-dessus du mini-timer tant que celui-ci gardait la fenêtre ouverte.
- La fenêtre n'est plus fixée en bas au centre : position au choix ou glissée par une poignée, retenue par le process principal (fichier dans `userData`, pas une donnée de module), ramenée dans l'écran. La poignée prend la souris seulement quand elle est survolée (événements de souris transmis à la page, `setIgnoreMouseEvents(true, { forward: true })`).

## Révision v0.23 — glissement natif

Constat sous Windows (écran à 150 %) : le suivi du curseur par le process principal (toutes les 16 ms) était imprécis et faisait dériver la fenêtre vers le bas quand on gardait la poignée enfoncée (arrondis entre pixels physiques et DIP à chaque relecture des bornes).

- La poignée est maintenant une **zone de glisser native** (`-webkit-app-region: drag`, fenêtre `movable`) : c'est Windows qui déplace la fenêtre, donc précis, fluide, correct avec la mise à l'échelle, sans dérive. Plus aucun calcul de position pendant le glisser.
- Comme une zone de glisser ne reçoit pas d'événements de souris, la poignée a un **rebord** (zone normale) qui voit le curseur arriver (événements transmis) et fait prendre la souris à la fenêtre ; le process principal la rend dès que le curseur sort de la fenêtre (vérification toutes les 200 ms, uniquement pendant le survol).
- Fin du glisser : `moved` (Windows, macOS), sinon 600 ms sans mouvement. La position est alors retenue comme avant, la fenêtre ramenée dans l'écran et remise à la taille de son contenu. Les déplacements faits par le hub lui-même sont reconnus (2 px d'arrondi tolérés) et ne comptent pas comme un glisser.
- Verrou : poignée cachée et fenêtre non déplaçable (`setMovable(false)`).
