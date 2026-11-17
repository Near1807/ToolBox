# 0048 — Menu contextuel commun (clic droit, clavier, appui long)

- Statut : acceptée (v0.42.0, fonction marquée « Expérimental »)
- Date : 17/11/2026

## Contexte

Thomas veut agir vite sur un élément (une tâche à cocher, un cours à rendre facultatif, un outil à monter) sans ouvrir sa fiche. La barre des outils avait déjà un petit menu au clic droit, propre au shell. Chaque module en inventant un aurait donné des menus différents, des raccourcis incohérents et des actions dangereuses sans confirmation.

## Décision

1. **Un composant et un hook dans `@hub/sdk`** (`packages/sdk/context-menu.tsx`) : `useContextMenu()` donne `bind(() => items, label)` à poser sur chaque élément, et `node` à placer une fois dans la page. Le shell s'en sert aussi (son ancien menu est retiré).
2. **Les éléments d'un menu** : action (libellé, icône du SDK, raccourci affiché, désactivée avec une raison lisible), séparateur, titre, **un seul niveau** de sous-menu, action **dangereuse** (rouge, et sa question `confirm` est toujours posée avant ; l'« Annuler » reste celui de la page).
3. **Ouverture** : clic droit ; touche Menu ou Maj+F10 (au-dessous de l'élément) ; **appui long** sur le téléphone (500 ms immobile ; un mouvement de plus de 10 px ou un défilement l'annule, donc ni le défilement ni le glisser d'un bloc n'en souffrent ; le relâcher qui suit n'ouvre pas l'élément).
4. **Fermeture** : Échap, clic ailleurs, défilement, redimensionnement, perte du focus. Le menu reste dans la fenêtre (retourné à gauche / en haut près d'un bord). Clavier : flèches, Début / Fin, Entrée / Espace, → et ← pour le sous-menu, Tab ferme.
5. **Règles** : un menu ne contient que des actions **déjà possibles ailleurs** dans l'interface (aucun pouvoir nouveau) ; une action dangereuse garde sa confirmation et son « Annuler » ; un menu vide ne s'ouvre pas, et un élément qui n'en déclare pas garde le menu du navigateur. Style unique, jetons du thème.
6. **Premiers usages** (v0.42.0) : les blocs de l'Agenda (semaine du PC, jour du téléphone, « À caser », deadlines) et la barre des outils.

## Conséquences

- Logique pure testée (clavier, choix, confirmation, placement, appui long : `tests/context-menu.test.ts`) ; l'ouverture réelle est mesurée dans l'app.
- Étendre le clic droit aux autres modules est dans la feuille de route (« Clic droit partout »), module par module.
- Écarté : le menu natif d'Electron (pas sur le téléphone, pas aux couleurs du thème, pas de sous-menu dans la page).
