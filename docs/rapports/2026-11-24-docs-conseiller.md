# Compte rendu — dossier du conseiller (24/11/2026)

Session de documentation seulement : aucun fichier de code, de test ni de configuration de build modifié ; version de l'app inchangée (0.48.0).

## Fichiers créés

- `docs/conseiller/REPRISE.md` — reprise du suivi par une instance externe, rôle du conseiller, forme d'un prompt, boucle de travail, « Où on en est ».
- `docs/conseiller/EN-ATTENTE.md` — idées décidées, pas encore faites.
- `docs/conseiller/prompts/README.md` — comment lancer un prompt.
- `docs/conseiller/prompts/v0.49.0-dossiers.md` — prompt de la session v0.49.0 (prêt, non fait).
- Ce compte rendu.

## Fichier modifié

- `CLAUDE.md` : règle « Dossier du conseiller » (fin de session) et `docs/conseiller/` dans « Structure ».

## Écart avec le « tel quel » (décidé par Thomas)

Prettier, qui fait partie de `npm run lint`, refusait les fichiers recopiés au caractère près :

- une ligne vide a été ajoutée après chaque titre (aucun mot changé) ;
- dans le prompt v0.49.0, `__pycache__` est écrit entre accents graves. Sinon, Prettier le transformait en « **pycache** » ; et sans accents graves, il s'affiche en gras « pycache » sur GitHub.

Rien d'autre ne diffère du texte fourni.

## Vérifications

`npm run lint`, `npm run typecheck`, typecheck du téléphone et `npm test` verts avant le commit (rien ne devait changer, rien n'a changé).

## Commit

« Docs : dossier du conseiller (reprise, idées en attente, prompt v0.49.0) », poussé sur `hub-v1`.
