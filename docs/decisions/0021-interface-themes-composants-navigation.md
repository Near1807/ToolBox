# 0021 — Interface : thèmes par variables CSS, composants partagés, navigation à catégories

- Statut : acceptée
- Date : 2026-10-21

## Contexte

L'interface avait un seul thème sombre, des couleurs écrites en dur dans plusieurs modules, et chaque module dessinait à sa façon ses éléments générés (cartes, cases « Publié », boutons). La barre latérale suivait les sections des manifests, sans réglage possible. Thomas veut un look technique et sympa inspiré de GameLife, plusieurs thèmes, une interface cohérente d'un module à l'autre, et ranger ses outils lui-même.

## Décision

- **Thèmes = fichiers de variables CSS** (`frontend/src/themes/<id>.css`, en-tête `@theme`), découverts au build. Le shell, le SDK et les modules n'utilisent que ces variables ; un contrôle (`check:ui-colors`, dans `npm run lint`) refuse toute couleur écrite en dur dans l'interface, et un test vérifie que chaque thème définit tous les tokens. 5 thèmes, dont « Nebula » repris de GameLife (défaut) et un thème clair. Le choix est un réglage caché du socle (`ui.theme`), recopié dans le navigateur pour s'appliquer avant le premier affichage. La barre de titre Windows suit le mode clair/sombre (preload → `nativeTheme`).
- **Les thèmes concernent l'interface, jamais les visuels générés** (direction artistique, ADR 0016).
- **Composants partagés dans le SDK** (`packages/sdk/components.tsx`) : carte d'élément généré, miniature à glisser, pastille d'état, case « Publié », actions, forme d'onde des extraits, champs de texte modifiables. Leur usage est une règle du contrat (MODULES.md §7.1), pas une option.
- **Textes : les modèles pré-remplissent seulement.** Un texte modifié sous l'élément ne bouge plus ; « Enregistrer comme modèle par défaut » fait l'inverse du remplissage (`toTemplate`). Une seule implémentation (`@hub/sdk/texts`).
- **Navigation** : catégories de l'utilisateur stockées en JSON par le socle (`ui.navigation`), la `section` du manifest n'étant que la catégorie par défaut. Logique en fonctions pures (`navigation.ts`), testée. Le socle ne connaît aucun module : il stocke le JSON tel quel.

## Conséquences

- Ajouter un thème = ajouter un fichier, rien d'autre.
- Un module qui veut une couleur nouvelle ajoute un token à tous les thèmes (docs/THEMES.md).
- Polices embarquées (Inter, Space Grotesk, JetBrains Mono) : ~300 Ko de plus dans l'app, aucun accès réseau. La CSP autorise `font-src 'self' data:`.
