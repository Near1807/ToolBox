# 0057 — Socle : la recherche partout (Ctrl+K), contrat `ctx.search`

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/MODULES.md` §5.18, ADR 0056

## Contexte

Ctrl+K mettait le curseur dans le champ de la barre latérale (filtrer les outils) ; dans le Coffre, il ouvrait la recherche du Coffre. Thomas veut chercher **depuis n'importe quelle page** (depuis l'Agenda : un mot dans un PDF du Coffre). Règle d'or : le socle ne connaît aucun module.

## Décision

- **Contrat générique** : un module déclare un fournisseur, `ctx.search.provide({ label?, search(query, limit), more?(query) })`. Un résultat : `id`, `title`, `snippet` (extrait, mots marqués entre U+0001 et U+0002), `hint` (« Cours › Thermo · page 3 »), `icon` (une icône du SDK), `open` (la route qui l'ouvre). Lecture seule, rapide (il répond pendant la frappe).
- Le socle les interroge tous en parallèle : `GET /api/core/search?q=&limit=` → groupes par module, temps de chacun ; un fournisseur en erreur ou plus lent que 2 s est écarté (les autres répondent).
- Portable (`backend/core/search.ts` sans import de Node) : l'hôte du téléphone a aussi `ctx.search` (pas encore de page de recherche sur le téléphone).
- **Ctrl+K partout** ouvre la palette du socle (`frontend/src/shell/SearchPalette.tsx`) : les **outils** (la recherche de navigation de la barre latérale, gardée), puis les résultats de chaque module ; ↑ ↓, Entrée, Échap. Ouvrir un résultat = aller à sa route, rien d'autre.
- Le champ de la barre latérale reste un filtre des outils (sans raccourci). Dans le Coffre, Ctrl+K ouvre aussi la palette (le champ de recherche du Coffre reste sur son accueil) : un seul comportement partout.
- Le Coffre est le premier fournisseur ; « Tous les résultats » mène à sa page de recherche (pastilles).
- Composant du SDK `MarkedText` : affiche un extrait avec ses mots marqués, jamais du HTML.

## Conséquences

- Un module qui veut être cherchable ajoute un fournisseur ; aucun changement du socle.
- Changer le raccourci : `SearchPalette.tsx` (le réglage de raccourci comme pour « Ajouter » viendra si Thomas le demande).
