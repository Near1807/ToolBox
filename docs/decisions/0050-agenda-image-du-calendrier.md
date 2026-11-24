# 0050 — Agenda : image du calendrier (copier, partager)

- Statut : acceptée (v0.44.0, fonction marquée « Expérimental »)
- Date : 20/11/2026

## Contexte

Thomas veut envoyer son agenda à quelqu'un (« voilà mes dispos ») : un clic pour copier une image de ce qu'il regarde, à coller dans une discussion. Une capture d'écran ne convient pas : elle est coupée par le défilement, elle montre l'interface (fiche ouverte, aperçu, « À caser », charge, badges) et elle ne sait pas cacher les titres.

## Décision

1. **Un rendu dédié, en deux temps** : `modules/agenda/shared/snapshot.ts` construit une **scène** (formes et textes) à partir des éléments affichés (interrupteurs appliqués) ; `shared/snapshot-paint.ts` la peint sur un contexte 2D. La scène est pure et testée sans navigateur ; la peinture marche sur le `<canvas>` de la page (PC et téléphone, même code) et sur `@napi-rs/canvas` dans les tests. **Aucune dépendance nouvelle.**
2. **Couleurs du thème, jamais écrites** : les jetons sont lus dans le thème de l'app (`getComputedStyle`) ou, pour « Thème clair » (le défaut, le plus lisible dans une discussion), dans les règles du thème « Clair » des feuilles de style chargées (`themeTokens`) ; `var()` remplacés, couleurs composées sur la surface. Le contrôle `check:ui-colors` reste vert.
3. **« Dispos seulement »** : les éléments sont réduits à « Occupé » **avant** la construction de la scène (aucun titre, lieu ni note n'atteint le dessin) ; deadlines et légende retirées. Les notes ne sont jamais dans l'image.
4. **Sortie** : PC → presse-papiers du système par le preload (`copyImage`) et le processus principal (`clipboard.write` d'Electron 44 ; fenêtre principale, PNG vérifié, 40 Mo au plus) — le backend n'importe jamais Electron ; téléphone → menu de partage d'Android par `ctx.files.saveAs` (mécanisme existant), la copie du cache supprimée ensuite ; « Enregistrer l'image… » → `ctx.files.saveAs` (route `POST /image/save`).
5. **Réglages locaux** : le mode et le thème de l'image sont retenus sur l'appareil (`localStorage`), jamais synchronisés ; aucune migration.

## Conséquences

- L'image n'est pas une copie pixel de l'écran : petites différences de mise en page voulues (toutes les heures, pas d'interface).
- Le SDK gagne `copyImage` (frontend), `useContextMenu().openAt` (le menu d'un bouton) et l'icône `share`.
- Le partage du téléphone supprime désormais toute copie qu'il met dans le cache (aussi celles des autres exports) : au retour sur l'app, 5 min au plus, et au démarrage.
- Écartés : `html2canvas` / `html-to-image` (dépendance, capture de l'interface et de son défilement) ; un rendu côté serveur (`@napi-rs/canvas`, absent du téléphone).
