# Décisions d'architecture (ADR)

Une note courte par choix structurant : contexte, décision, conséquences. On ne réécrit pas une ADR : si une décision change, on en ajoute une nouvelle qui la remplace (et on indique « Remplacée par NNNN » dans l'ancienne).

Modèle :

```markdown
# NNNN — Titre

- Statut : acceptée | remplacée par NNNN
- Date : AAAA-MM-JJ

## Contexte

## Décision

## Conséquences
```

| N°   | Décision                                                                                   |
| ---- | ------------------------------------------------------------------------------------------ |
| 0001 | [Electron, backend dans le process principal](0001-electron-backend-dans-le-main.md)       |
| 0002 | [API REST Fastify sécurisée, interface même origine](0002-api-fastify-securite.md)         |
| 0003 | [SQLite avec better-sqlite3 (N-API, sans rebuild)](0003-sqlite-better-sqlite3.md)          |
| 0004 | [Frontend React + Vite, HashRouter](0004-frontend-react-vite.md)                           |
| 0005 | [Modules compilés dans l'app](0005-modules-compiles-dans-l-app.md)                         |
| 0006 | [FFmpeg embarqué, licence GPL](0006-ffmpeg-embarque-gpl.md)                                |
| 0007 | [Distribution Windows non signée, CI GitHub Actions](0007-distribution-windows.md)         |
| 0008 | [Outillage : TypeScript 6, esbuild, Vitest sous Node](0008-outillage.md)                   |
| 0009 | [Cycle de vie et frontières des modules](0009-cycle-de-vie-des-modules.md)                 |
| 0010 | [Sécurité des données : sauvegardes, restauration, export](0010-securite-des-donnees.md)   |
| 0011 | [Tâches longues et planificateur dans le process](0011-taches-et-planificateur.md)         |
| 0012 | [Fichiers locaux, médias et texte dans les vidéos](0012-fichiers-medias-et-texte-video.md) |
