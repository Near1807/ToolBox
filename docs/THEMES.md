# Thèmes de l'interface

> Les thèmes habillent **l'interface de ToolBox** (fenêtres, menus, cartes, boutons). Ils ne touchent jamais aux **visuels générés** (vidéos, Reels, images de post) : ceux-là suivent `docs/DIRECTION-ARTISTIQUE.md`, quel que soit le thème choisi.

## Principe

- Toute couleur, tout arrondi, toute ombre et toute police de l'interface est une **variable CSS** (« token »). Un thème est un fichier qui donne une valeur à chacun de ces tokens, rien d'autre.
- Le shell (`frontend/src/styles.css`), les composants partagés du SDK et les modules n'utilisent **que** ces variables : aucune couleur écrite en dur (`#hex`, `rgb()`, `hsl()`). `npm run lint` le vérifie (`scripts/check-ui-colors.mjs`) ; un test vérifie que chaque thème définit tous les tokens.
- Le choix se fait dans **Réglages › Apparence** : une **galerie de miniatures**, chacune dessinée avec les vrais tokens de son thème (`data-theme-preview`, voir plus bas) ; un clic applique le thème tout de suite. Il est retenu par le socle (réglage caché `ui.theme`, routes `GET/PUT /api/core/ui`) et recopié dans le navigateur pour s'afficher dès le démarrage, sans clignotement ; la fenêtre flottante suit le changement (événement `storage`). La barre de titre Windows suit le mode clair ou sombre du thème affiché.
- **Thème du soir** (désactivé par défaut) : un thème le jour, un autre de l'heure choisie jusqu'au matin (réglages cachés `ui.themeEvening`, `ui.themeNight`, `ui.themeEveningFrom`, `ui.themeEveningTo`, vérifié toutes les 30 s ; pendant le soir, un clic dans la galerie change le thème du soir).
- **Raccourci « thème suivant »** (aucun par défaut, `ui.themeShortcut`) : une lettre ou un chiffre avec Ctrl ou Alt, ou une touche F1–F12 sauf F11 ; actif quand la fenêtre de ToolBox a le focus. Logique pure : `frontend/src/themes/automation.ts`.

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

## Lisibilité (obligatoire pour chaque thème)

Vérifiée automatiquement sur les tokens par `tests/theme-contrast.test.ts` (outils : `tests/helpers/contrast.ts`), pour **chaque** fichier de thème :

| Règle                                                                                                                                                     | Minimum                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `--text` et `--text-2` sur `--bg`, `--surface`, `--surface-2`, `--surface-hover`, `--surface-solid`, `--field` (surfaces translucides posées sur le fond) | 4,5:1 (WCAG AA, texte normal et petit) |
| `--text-3` (texte discret, désactivé, indications) sur les mêmes surfaces                                                                                 | 3:1                                    |
| États et liens comme texte (`--success`, `--warning`, `--danger`, `--accent-2`, `--info`) sur `--surface` et `--surface-2`                                | 4,5:1                                  |
| `--text-on-accent` sur `--accent` et sur **chaque** couleur du dégradé `--accent-grad`                                                                    | 4,5:1                                  |
| `--accent` (onglet actif, bordure sélectionnée) sur `--surface`, focus sur `--bg` et `--surface`                                                          | 3:1                                    |
| `--series-1` … `--series-8` sur `--surface`                                                                                                               | 3:1                                    |
| Séries distinctes entre elles (distance OKLab) : les 4 premières ≥ 0,09, les 8 ≥ 0,055 ; les 4 premières aussi avec une deutéranopie simulée ≥ 0,05       | —                                      |
| Bord des contrôles (`--control-border`, sinon `--border-strong`) sur `--surface`, pour qu'un champ ou un bouton se voie sans survol                       | 1,4:1                                  |

Et à l'œil, captures à 1 280 px (accueil, To-do, Timer et fenêtre flottante, Stats YouTube, Analyse du master, Courses, Sport, Réglages) :

- un élément cliquable se repère **sans survol** (fond, bord ou relief) ; l'élément sélectionné et le focus clavier se voient nettement — piège du neumorphisme : tout se fond dans le fond, d'où, dans Argile, un bord léger, l'onglet actif enfoncé, l'anneau de focus de 3 px ;
- les graphes ont une légende ou des étiquettes, et les séries proches se distinguent aussi par la forme (trait plein / pointillé) : la couleur seule ne porte jamais l'information.

## Ajouter un thème

1. Copier un thème existant dans `frontend/src/themes/<id>.css` (le plus proche de l'idée : `clair.css` pour un thème clair).
2. Adapter l'en-tête, lu par l'app pour le sélecteur :
   ```css
   /* @theme id=<id>; label=<Nom affiché>; scheme=dark|light; swatch=<fond>,<accent>,<accent 2> */
   :root[data-theme='<id>'] { … }
   ```
3. Donner une valeur à **tous** les tokens (le test `tests/themes.test.ts` échoue sinon).
4. Lancer `npx vitest run tests/theme-contrast.test.ts` : chaque échec dit la paire et son contraste. Puis regarder les pages listées ci-dessus (lisibilité à l'œil).

Un aperçu dans la galerie reprend le thème : chaque `:root[data-theme='<id>']` est aussi appliqué à `[data-theme-preview='<id>']` à l'injection (`withPreview`, `frontend/src/themes/index.ts`), et les valeurs par défaut des tokens facultatifs sont recalculées sur l'aperçu. Rien à faire de plus dans le fichier du thème.

C'est tout : le fichier est découvert au build (`import.meta.glob`), il apparaît dans Réglages › Apparence. Aucun autre fichier à toucher.

## Pour les modules

- Utiliser les classes du shell (`card`, `button`, `badge`, `input`, `list`…) et les **composants partagés** du SDK (`OutputCard`, `MediaThumb`, `FileActions`, `PublishedCheck`, `StateBadge`, `CopyButton`, `ExcerptWaveform`, `TextFields`… voir `docs/MODULES.md` §7).
- Le CSS propre au module ne contient que de la mise en page et des variables : jamais de couleur en dur. Si un besoin n'est couvert par aucun token, ajouter le token **à tous les thèmes** et le documenter ici.
- Une couleur qui vient des données (couleurs extraites d'une cover, par exemple) n'est pas une couleur d'interface : elle peut être passée en style inline depuis les données.
