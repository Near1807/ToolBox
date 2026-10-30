# 0039 — La fenêtre flottante prend le clavier par étapes, et le dit quand elle n'y arrive pas

- Statut : acceptée
- Date : 2026-10-30

## Contexte

La barre de commande écrite (ADR 0037) s'ouvre par une touche alors qu'une autre application est au premier plan (FL Studio…). Windows refuse le premier plan à un processus qui n'a pas reçu la dernière saisie (« verrou du premier plan ») : le crochet clavier global (uiohook, ADR 0028) ne compte pas. Résultat possible : la barre s'affiche mais les touches partent dans l'application d'en dessous, sans que Thomas le voie.

## Décision

Dans `electron/overlay-focus.ts` (pur, testé avec une fausse fenêtre), la fenêtre flottante prend le clavier **par étapes, en vérifiant après chacune** (`isFocused()` 120 ms plus tard) :

1. rendue focusable, au-dessus de tout (`moveTop`, déjà « toujours au premier plan » niveau `screen-saver`), affichée, `focus()` de la fenêtre puis de sa page ;
2. si ce n'est pas suffisant, **sous Windows seulement** : un appui sur Alt simulé (uiohook `keyToggle`) **autour** de la même demande. C'est la méthode documentée pour qu'un processus ait le droit de prendre le premier plan (il a « produit » la dernière saisie). Ces deux événements ne sont jamais vus comme une touche de Thomas (le crochet les ignore) ;
3. toujours pas : la barre **le montre** (bord et champ orange, « Clique dans le champ pour écrire : le clavier est resté sur l'autre application. »). Un clic dans le champ suffit : la fenêtre prend alors la souris et le clavier.

La page suit l'état réel (`focus` / `blur` de la fenêtre et le résultat envoyé par le processus principal) : le message disparaît dès que le clavier arrive.

`app.focus({ steal: true })` n'est pas utilisé : il ne sert que sous macOS, et sous Windows il mettrait la fenêtre principale de ToolBox devant, ce que la barre veut justement éviter. `AllowSetForegroundWindow` n'a de sens qu'appelé par le processus au premier plan (l'autre application) : inutilisable ici sans module natif.

## Conséquences

- Aucun module natif nouveau : uiohook est déjà chargé quand la barre s'ouvre par une touche.
- L'Alt simulé n'est envoyé que si la première étape a échoué ; si même ainsi le clavier ne vient pas, l'Alt relâché peut arriver à l'application d'en dessous (au pire, sa barre de menus se sélectionne ; Échap la referme). Noté dans le rapport, à surveiller sur le PC de Thomas.
- Le comportement réel dépend de Windows : à vérifier sur le PC de Thomas (liste de tests dans `docs/WINDOWS.md`).
