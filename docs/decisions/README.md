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
| 0023 | [Reels depuis les vidéos de l'utilisateur : module séparé, banque d'effets](0023-reels-depuis-mes-videos.md)                         |
| 0024 | [Services facultatifs : un module n'exige que ce sans quoi il n'a aucun sens](0024-services-facultatifs.md)                          |
| 0025 | [Rattachement complet : chaque module suit (`ctx.outputs.onReattach`)](0025-rattachement-complet.md)                                 |
| 0026 | [Reels perso : passage = départ + durée du Reel, son au choix, morceau synchronisé](0026-son-et-passages-des-reels-perso.md)         |
| 0027 | [Stats YouTube : données locales, niveaux de confiance, démo, CSV en repli](0027-stats-youtube.md)                                   |
| 0028 | [Actions des modules pour l'assistant, touche globale, indicateur flottant](0028-actions-des-modules-pour-l-assistant.md)            |
| 0029 | [Assistant vocal local : whisper.cpp, Ollama, Piper](0029-assistant-vocal-local.md)                                                  |
| 0030 | [Commandes standardisées de l'assistant, interrupteur « IA », droits un par un](0030-commandes-standardisees.md)                     |
| 0031 | [Quota YouTube partagé : le Planning passe avant les Stats](0031-quota-youtube-planning-avant-stats.md)                              |
| 0032 | [Mots de l'assistant : mots attendus, corrections, surnoms, noms au son](0032-mots-de-l-assistant.md)                                |
| 0033 | [Stats YouTube : deux sources dites, l'API avant le CSV, imports supprimables](0033-stats-youtube-sources-et-imports.md)             |
| 0034 | [Analyse du master : mesures vérifiées contre ebur128, cache par contenu, intégrations facultatives](0034-analyse-du-master.md)      |
| 0035 | [Timer : temps tiré de l'heure réelle, une seule session, To-do facultative](0035-timer.md)                                          |
