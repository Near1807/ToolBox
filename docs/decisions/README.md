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

| N°   | Décision                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0001 | [Electron, backend dans le process principal](0001-electron-backend-dans-le-main.md)                                                 |
| 0002 | [API REST Fastify sécurisée, interface même origine](0002-api-fastify-securite.md)                                                   |
| 0003 | [SQLite avec better-sqlite3 (N-API, sans rebuild)](0003-sqlite-better-sqlite3.md)                                                    |
| 0004 | [Frontend React + Vite, HashRouter](0004-frontend-react-vite.md)                                                                     |
| 0005 | [Modules compilés dans l'app](0005-modules-compiles-dans-l-app.md)                                                                   |
| 0006 | [FFmpeg embarqué, licence GPL](0006-ffmpeg-embarque-gpl.md)                                                                          |
| 0007 | [Distribution Windows non signée, CI GitHub Actions](0007-distribution-windows.md)                                                   |
| 0008 | [Outillage : TypeScript 6, esbuild, Vitest sous Node](0008-outillage.md)                                                             |
| 0009 | [Cycle de vie et frontières des modules](0009-cycle-de-vie-des-modules.md)                                                           |
| 0010 | [Sécurité des données : sauvegardes, restauration, export](0010-securite-des-donnees.md)                                             |
| 0011 | [Tâches longues et planificateur dans le process](0011-taches-et-planificateur.md)                                                   |
| 0012 | [Fichiers locaux, médias et texte dans les vidéos](0012-fichiers-medias-et-texte-video.md)                                           |
| 0013 | [Glisser des fichiers hors de l'application](0013-glisser-deposer-vers-l-exterieur.md)                                               |
| 0014 | [Registre des fichiers générés (`ctx.outputs`)](0014-registre-des-fichiers-generes.md)                                               |
| 0015 | [Reels : quatre styles, sans spectre](0015-styles-de-reels.md) — remplacée par 0016                                                  |
| 0016 | [Direction artistique sobre](0016-direction-artistique-sobre.md)                                                                     |
| 0017 | [Reels rendus image par image, mouvement piloté par le son](0017-rendu-image-par-image.md)                                           |
| 0018 | [Comptes connectés : OAuth « application installée », dans le socle](0018-comptes-oauth.md)                                          |
| 0019 | [Notifications Windows et démarrage dans la zone de notification](0019-notifications-et-zone-de-notification.md)                     |
| 0020 | [Planning de sortie : programmation sur YouTube, rappels pour Instagram](0020-planning-de-sortie.md)                                 |
| 0021 | [Interface : thèmes par variables CSS, composants partagés, navigation à catégories](0021-interface-themes-composants-navigation.md) |
| 0022 | [Tout élément généré appartient à un projet (le morceau)](0022-projets.md)                                                           |
