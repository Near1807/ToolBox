# 0026 — Reels perso : passage = départ + durée du Reel, son au choix, morceau synchronisé

- Statut : acceptée
- Date : 2026-10-22

## Contexte

Dans « Reels depuis mes vidéos », le passage vidéo se choisissait par un début et une fin : sa durée était imprécise et pouvait différer de celle du Reel. Le prototype v0.13 (validé par Thomas) ajoutait trois sons au choix, l'effet « Caméra embarquée », l'intensité et le texte à l'écran, sans les solidifier.

## Décision

- **Un passage = un départ.** Sa durée est toujours exactement la durée du Reel (le réglage « Durée », le même que l'extrait du morceau). L'interface est celle de l'extrait : une fenêtre de largeur fixe sur la pellicule de la vidéo (composant partagé `FilmstripWindow`). Les passages enchaînés gardent chacun une durée, mais leur somme vaut toujours celle du Reel (le dernier prend le reste). Logique pure dans `custom-reels/backend/passages.ts`. Les passages enregistrés avant (début, fin) sont relus sans migration.
- **Son au choix par Reel** : extrait du morceau, son de la vidéo (normalisé à -14 LUFS), ou « Morceau synchronisé » (le master calé là où le morceau joue dans la vidéo). Le Reel dure la même durée dans tous les modes, toujours limité à -1,1 dBTP. Les effets suivent le son final (analysé après sa fabrication).
- **Synchro par passage**, pas par vidéo : seul le passage choisi (± 1 s) est cherché, donc un morceau joué plusieurs fois dans la vidéo est trouvé au bon endroit. Caractéristique robuste à une prise de son au téléphone : le flux spectral (montées du log de l'énergie par bande), corrélé de façon normalisée à chaque décalage (FFT), puis affiné à la milliseconde. Fiable seulement si le pic ressort nettement (saillance ≥ 5,5 écarts-types et ≥ 1,3 fois le meilleur autre endroit) ; sinon c'est dit, avec le repli « Son de la vidéo ». Résultats gardés sur le Reel (colonne `sync`, migration 4), recherchés dès qu'on choisit le mode ou déplace un passage.
- **« Caméra embarquée »** rejoint la banque d'effets ; « Intensité » (×0,55 / ×1 / ×1,6) change l'amplitude, jamais le moment des mouvements.

## Conséquences

- Testé : passages (redimensionnement, recalage, boucle, enchaînés), synchro (≤ 10 ms sur captures dégradées, morceau joué deux fois, refus sans le morceau), modes de son sur rendus réels (durée exacte, ≤ -1,1 dBTP, master calé à ≤ 10 ms), effets (pic à l'image de l'attaque à chaque intensité, cadre toujours rempli).
- Les colonnes `sync_*` des vidéos (prototype, synchro sur toute la vidéo) restent en base mais ne servent plus.
- Seuils de synchro mesurés sur des captures simulées : à confirmer sur de vraies vidéos de téléphone.
