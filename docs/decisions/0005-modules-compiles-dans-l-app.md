# 0005 — Modules compilés dans l'app

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Les modules doivent être découverts automatiquement, sans modifier le socle. Deux options : découverte au build (modules compilés dans le `.exe`) ou découverte à l'exécution (plugins déposés dans une app installée).

## Décision

Découverte **au build** : le frontend utilise `import.meta.glob` sur `modules/*/frontend/index.tsx`, et le build du backend compile chaque `modules/*/backend/index.ts`. **Ajouter un module = ajouter un dossier + rebuild.**

## Conséquences

- Pas de chargement de code arbitraire à l'exécution : plus simple et plus sûr.
- Typage de bout en bout et tests des modules dans la même CI.
- Installer un nouveau module demande une nouvelle version du `.exe`, ce qui est acceptable pour un usage personnel.
