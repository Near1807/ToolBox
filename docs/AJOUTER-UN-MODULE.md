# Ajouter un module

> **Statut : à écrire en phase 1**, en même temps que le module modèle `modules/_template/`.

En résumé (détails à venir) :

1. Copier `modules/_template/` vers `modules/<nouvel-id>/`.
2. Remplir `module.json`, puis implémenter `backend/index.ts` et `frontend/index.tsx` en suivant `docs/MODULES.md`.
3. Écrire le `README.md` du module et ses tests.
4. `npm run dev` : le module apparaît sur la page d'accueil, sans toucher au socle.
5. Rebuild pour l'inclure dans le `.exe` (`npm run dist:win` ou tag `v*`).

Ce guide contiendra aussi la section **« Intégrer une app existante »**.
