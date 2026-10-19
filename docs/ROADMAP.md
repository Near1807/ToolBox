# Feuille de route

Légende : ✅ fait · 🚧 en cours · ⏳ prévu

## V1 — espace Musique

| Phase | Contenu                                                                                                                                                                                                                                                                                         | Statut      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0     | Squelette Electron + Fastify + React, scripts dev/build/test/lint, CI Windows qui produit un `.exe` testé, CLAUDE.md, docs et ADR initiaux                                                                                                                                                      | ✅ (v0.1.0) |
| 1     | Socle : chargeur de modules, `ctx` (db, files, settings, jobs, scheduler, events, services, logger), accueil par sections, réglages auto-générés, journaux, `modules/_template`, contrat complet (`MODULES.md`, `AJOUTER-UN-MODULE.md`), sauvegardes automatiques avant migration + export .zip | ✅ (v0.2.0) |
| 2     | `music-library` : bibliothèque de morceaux (glisser-déposer, ffprobe, édition, mini-lecteur, service partagé)                                                                                                                                                                                   | ✅ (v0.4.0) |
| 3     | `video-engine` (moteur de rendu partagé, aperçu, progression, annulation) + `youtube-video` (16:9, description)                                                                                                                                                                                 | ✅ (v0.4.0) |
| 4     | `instagram-video` : Reel 9:16, extrait réglable, « suggérer un passage » (RMS), légende avec hashtags                                                                                                                                                                                           | ⏳          |
| 5     | `ctx.accounts` (OAuth Google), planificateur avec rattrapage, `youtube-stats`                                                                                                                                                                                                                   | ⏳          |
| 6     | Finitions, test du `.exe` installé, doc complète, v1.0.0                                                                                                                                                                                                                                        | ⏳          |

## Plus tard (hors V1, la structure doit le permettre)

- **Upload YouTube direct** depuis l'app : générer → publier en un clic (emplacement prévu dans `youtube-video`).
- **Instagram** : stats et publication de Reels via l'API Instagram de Meta (compte Créateur/Professionnel + app Meta développeur). Futur module `instagram-stats`, compte géré par `ctx.accounts`.
- **SoundCloud** : stats via l'API officielle (abonnement Artist Pro requis pour obtenir des identifiants). Futur module `soundcloud-stats`.
- **Tableau de bord unifié** multi-plateformes par morceau.
- **Styles visuels** multiples, couleurs extraites automatiquement de la cover.
- **Pulsation de la cover sur les basses** (la V1 utilise un zoom lent ; FFmpeg ne sait pas animer une image d'après l'audio sans pré-analyse, à faire avec un fichier `sendcmd` généré depuis l'enveloppe des basses).
- Remplacement du son d'un morceau existant (aujourd'hui : supprimer et réimporter).
- **Démarrage avec Windows et icône dans la zone de notification**, pour que les relevés planifiés tournent même sans ouvrir l'app.
- **Intégration des apps existantes** (outil mails, boîte à outils gamifiée to-do/timer/habitudes/XP) en tant que modules adaptés au contrat.
- **Mise à jour automatique** de l'app.
- **Restauration d'une sauvegarde depuis l'interface** (aujourd'hui : procédure manuelle, voir `docs/WINDOWS.md`).
- Reprise automatique des tâches interrompues par la fermeture de l'app (aujourd'hui : marquées « interrompues », à relancer).
- Signature du code (supprimerait l'avertissement SmartScreen) si l'app est un jour distribuée.
