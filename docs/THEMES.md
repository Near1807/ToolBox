# Thèmes de l'interface

> Les thèmes habillent **l'interface de ToolBox** (fenêtres, menus, cartes, boutons). Ils ne touchent jamais aux **visuels générés** (vidéos, Reels, images de post) : ceux-là suivent `docs/DIRECTION-ARTISTIQUE.md`, quel que soit le thème choisi.

## Principe

- Toute couleur, tout arrondi, toute ombre et toute police de l'interface est une **variable CSS** (« token »). Un thème est un fichier qui donne une valeur à chacun de ces tokens, rien d'autre.
- Le shell (`frontend/src/styles.css`), les composants partagés du SDK et les modules n'utilisent **que** ces variables : aucune couleur écrite en dur (`#hex`, `rgb()`, `hsl()`). `npm run lint` le vérifie (`scripts/check-ui-colors.mjs`) ; un test vérifie que chaque thème définit tous les tokens.
- Le choix se fait dans **Réglages › Apparence**. Il s'applique tout de suite, il est retenu par le socle (réglage caché `ui.theme`, routes `GET/PUT /api/core/ui`) et recopié dans le navigateur pour s'afficher dès le démarrage, sans clignotement. La barre de titre Windows suit le mode clair ou sombre du thème.

## Thèmes fournis

| Fichier           | Nom                        | Mode   | Esprit                                                                                                                                                           |
| ----------------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nebula.css`      | Nebula (GameLife) — défaut | sombre | Repris de GameLife : quasi-noir, halos violet/cyan, panneaux en verre dépoli, dégradé violet → cyan                                                              |
| `console.css`     | Console                    | sombre | Tableau de bord technique : vert et ambre, angles plus nets, sans flou, titres en monospace                                                                      |
| `studio.css`      | Studio                     | sombre | Sombre chaud : orange et or                                                                                                                                      |
| `minuit.css`      | Minuit                     | sombre | Bleu nuit, bleu électrique et aqua                                                                                                                               |
| `clair.css`       | Clair                      | clair  | Fond gris très clair, cartes blanches, violet et bleu canard                                                                                                     |
| `argile.css`      | Argile                     | clair  | Neumorphisme : crème, éléments de la même matière en relief ou enfoncés (ombres doubles claire / foncée), bleu canard profond pour les actions, police Nunito    |
| `lilas.css`       | Lilas                      | clair  | Blanc lavande, cartes blanches aérées, magenta et violet, graphes en dégradé, police Plus Jakarta Sans                                                           |
| `lilas-nuit.css`  | Lilas de nuit              | sombre | Jumeau sombre de Lilas : bleu nuit violacé, mêmes accents                                                                                                        |
| `supervision.css` | Supervision                | sombre | Salle de contrôle : ardoise très sombre, lignes fines, ambre et corail, séries lavande et vert d'eau, titres en Chakra Petch, chiffres à chasse fixe             |
| `cuivre.css`      | Cuivre                     | sombre | Néo-skeuomorphisme, esprit console audio : anthracite à grain léger, cuivre, boutons en relief, état pressé enfoncé, lueur cuivrée sur l'actif, titres en Oswald |

Polices embarquées (aucun accès réseau, toutes sous licence libre OFL) : Inter (texte), Space Grotesk (titres), JetBrains Mono (chiffres, durées, code), et pour certains thèmes Nunito, Plus Jakarta Sans, Oswald, Chakra Petch, via `@fontsource-variable/*` et `@fontsource/*` (importées dans `frontend/src/main.tsx` ; un fichier de police n'est lu que si un thème l'utilise). Icônes du shell : `lucide-react`.

## Les tokens

| Groupe   | Tokens                                                                      | Usage                                                                          |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Fond     | `--bg`, `--bg-glow-1`, `--bg-glow-2`                                        | fond de fenêtre et ses deux halos                                              |
| Surfaces | `--surface`, `--surface-2`, `--surface-hover`, `--surface-solid`, `--field` | cartes (verre), éléments internes, survol, menus opaques, champs               |
| Bordures | `--border`, `--border-strong`                                               | séparations fines, champs et boutons secondaires                               |
| Texte    | `--text`, `--text-2`, `--text-3`, `--text-on-accent`                        | principal, secondaire, discret, sur un bouton accentué                         |
| Accents  | `--accent`, `--accent-2`, `--accent-soft`, `--accent-grad`                  | couleur principale, seconde, halo de focus, dégradé des boutons                |
| États    | `--success`, `--warning`, `--danger`, `--info`                              | badges, messages                                                               |
| Séries   | `--series-1` … `--series-8`                                                 | couleurs distinctes : extraits 1–4 sur la forme d'onde, morceaux du calendrier |
| Marques  | `--brand-youtube`, `--brand-instagram`                                      | pictogrammes des plateformes                                                   |
| Médias   | `--media-bg`, `--overlay`, `--on-overlay`                                   | fond derrière une vidéo, pastille posée sur une image, son texte               |
| Effets   | `--shadow`, `--glow`, `--glow-2`, `--blur`                                  | ombre des cartes, halos, flou du verre (0 = pas de flou)                       |
| Formes   | `--radius-lg`, `--radius`, `--radius-sm`                                    | grands panneaux, cartes, boutons et champs                                     |
| Polices  | `--font-sans`, `--font-display`, `--font-mono`                              | texte, titres, données                                                         |

### Tokens facultatifs (relief, texture, lueur, graphes, focus)

Valeurs par défaut dans `frontend/src/styles.css` (bloc « Optional theme tokens ») : un thème qui ne les donne pas garde **exactement** l'aspect d'avant (vérifié par captures avant / après sur les 5 premiers thèmes). Un thème peut en redéfinir une partie ; le test refuse un token inconnu (faute de frappe).

| Groupe    | Tokens (défaut)                                                                                                                                 | Usage                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relief    | `--elev-flat` (rien), `--elev-hover` (`--glow`), `--elev-raised` (ombre des cartes), `--elev-modal` (`--shadow`), `--elev-popover` (`--shadow`) | niveaux d'élévation : posé (tuiles, cartes d'accueil), survol, surélevé (cartes `.card`), modal (toasts, fenêtre flottante), popover (menus, infobulles) |
| Relief    | `--inset` (rien), `--pressed` (rien), `--press-scale` (0.97)                                                                                    | surface enfoncée (champs, pistes, barre de progression) ; état pressé d'un bouton ou d'une carte cliquable                                               |
| Contrôles | `--button-shadow` (`--glow`), `--control-shadow` (rien), `--control-border` (`--border-strong`)                                                 | ombre du bouton principal, des boutons secondaires (relief au repos), bordure des champs et boutons                                                      |
| Contrôles | `--controls` (`native`)                                                                                                                         | `drawn` : cases à cocher, boutons radio, curseurs et onglets dessinés avec les tokens (relief, lueur) ; `native` : contrôles du système                  |
| Onglets   | `--tab-active-bg` (transparent), `--tab-active-shadow` (rien)                                                                                   | onglet sélectionné (avec `--controls: drawn`) : enfoncé en neumorphisme, en relief et lumineux en skeuomorphisme                                         |
| Texture   | `--texture` (`none`)                                                                                                                            | calque d'image sous le fond et les cartes (grain en SVG `data:` généré, ou petite image locale ; **jamais d'adresse réseau**)                            |
| Lueur     | `--glow-active` (rien)                                                                                                                          | élément actif : page en cours, case cochée, curseur                                                                                                      |
| Focus     | `--focus-color` (`--accent-2`), `--focus-width` (2px)                                                                                           | anneau de focus au clavier, toujours visible                                                                                                             |
| Graphes   | `--chart-area-top`, `--chart-area-bottom` (0 : pas d'aire), `--chart-bar-bottom` (1 : barre pleine), `--chart-grid` (`--border`)                | dégradé de l'aire sous la série principale (opacités en haut / en bas), dégradé des barres (opacité en bas), lignes de grille                            |
| Titres    | `--title-transform` (`none`), `--title-spacing` (-0.015em)                                                                                      | casse et espacement des titres de section (h2, h3)                                                                                                       |

Règles :

- « Pas d'ombre » s'écrit `0 0 transparent`, **jamais `none`** : ces ombres sont combinées dans des listes, où `none` annulerait toute la déclaration (le focus des champs disparaissait).
- Les graphes SVG prennent leurs dégradés avec `useChartGradient(couleur, 'area' | 'bar')` du SDK ; les canevas (Analyse du master) lisent les tokens par `getComputedStyle`.
- Les séries des graphes (`--series-1` … `--series-8`) sont propres à chaque thème : Stats YouTube, Analyse du master, Courses, Planning de sortie les utilisent.

Noms historiques, encore acceptés et redirigés par `styles.css` : `--bg-elevated` (= `--surface-solid`), `--bg-hover` (= `--surface-hover`), `--text-muted` (= `--text-2`), `--accent-strong` (= `--accent-2`), `--font` (= `--font-sans`). Dans du nouveau code, utiliser les noms ci-dessus.

Pour une teinte dérivée, mélanger des tokens plutôt qu'écrire une couleur : `color-mix(in srgb, var(--danger) 16%, transparent)`.

## Ajouter un thème

1. Copier un thème existant dans `frontend/src/themes/<id>.css` (le plus proche de l'idée : `clair.css` pour un thème clair).
2. Adapter l'en-tête, lu par l'app pour le sélecteur :
   ```css
   /* @theme id=<id>; label=<Nom affiché>; scheme=dark|light; swatch=<fond>,<accent>,<accent 2> */
   :root[data-theme='<id>'] { … }
   ```
3. Donner une valeur à **tous** les tokens (le test `tests/themes.test.ts` échoue sinon).
4. Vérifier la lisibilité : texte secondaire sur `--surface`, badges, forme d'onde (les quatre `--series`), page Réglages, calendrier du Planning de sortie.

C'est tout : le fichier est découvert au build (`import.meta.glob`), il apparaît dans Réglages › Apparence. Aucun autre fichier à toucher.

## Pour les modules

- Utiliser les classes du shell (`card`, `button`, `badge`, `input`, `list`…) et les **composants partagés** du SDK (`OutputCard`, `MediaThumb`, `FileActions`, `PublishedCheck`, `StateBadge`, `CopyButton`, `ExcerptWaveform`, `TextFields`… voir `docs/MODULES.md` §7).
- Le CSS propre au module ne contient que de la mise en page et des variables : jamais de couleur en dur. Si un besoin n'est couvert par aucun token, ajouter le token **à tous les thèmes** et le documenter ici.
- Une couleur qui vient des données (couleurs extraites d'une cover, par exemple) n'est pas une couleur d'interface : elle peut être passée en style inline depuis les données.
