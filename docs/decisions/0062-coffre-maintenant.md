# 0062 — Coffre : « Maintenant » (le cours en cours d'après l'Agenda)

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règle 9), ADR 0024 (dépendances facultatives)

## Contexte

En arrivant en cours, Thomas veut ses documents de ce cours sous la main, sans chercher.

## Décision

- Le service de l'Agenda gagne `coursesNow(withinMinutes)` : les créneaux de cours **importés** en cours ou qui commencent dans les `withinMinutes` minutes. **Lecture seule**, facultatif dans le contrat (un Agenda plus ancien ne l'a pas). Le Coffre garde l'Agenda en dépendance **facultative** : sans lui (ou sans cours maintenant), pas de zone.
- Accueil du Coffre, en haut : **« Maintenant »** — le cours (nom, code, « jusqu'à 12 h 45 » ou « commence à … »), son contexte, ses éléments **les plus récents d'abord** (ouverts, ajoutés ou modifiés), 12 au plus. Relu chaque minute.
- **Cours ↔ contexte** : lié à la main sur la page du contexte (« Lié au cours … », colonne `course_name` des contextes, migration 6, ajout seulement ; « Aucun cours » = `-`) ; sinon automatiquement, le contexte dont le nom est le nom ou le code du cours (le plus profond). Même règle pour l'en-tête « Cours de l'Agenda » d'un contexte.
- Fenêtre : 15 minutes avant le début.

## Conséquences

- Aucun réglage de plus ; la zone n'apparaît que pendant un cours (ou juste avant).
- Les événements non importés (rendez-vous) ne comptent pas comme des cours.
