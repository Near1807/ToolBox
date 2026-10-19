# Feuille de route

Légende : ✅ fait · 🚧 en cours · ⏳ prévu

## V1 — espace Musique

| Phase | Contenu                                                                                                                                                                                                                                 | Statut      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0     | Squelette Electron + Fastify + React, scripts dev/build/test/lint, CI Windows qui produit un `.exe` testé, CLAUDE.md, docs et ADR initiaux                                                                                              | ✅ (v0.1.0) |
| 1     | Socle : chargeur de modules, `ctx` (db, files, settings, jobs, scheduler, events, services, logger), accueil par sections, réglages auto-générés, journaux, `modules/_template`, contrat complet (`MODULES.md`, `AJOUTER-UN-MODULE.md`) | ⏳          |
| 2     | `music-library` : bibliothèque de morceaux (glisser-déposer, ffprobe, édition, mini-lecteur, service partagé)                                                                                                                           | ⏳          |
| 3     | `video-engine` (moteur de rendu partagé, aperçu, progression, annulation) + `youtube-video` (16:9, description)                                                                                                                         | ⏳          |
| 4     | `instagram-video` : Reel 9:16, extrait réglable, « suggérer un passage » (RMS), légende avec hashtags                                                                                                                                   | ⏳          |
| 5     | `ctx.accounts` (OAuth Google), planificateur avec rattrapage, `youtube-stats`                                                                                                                                                           | ⏳          |
| 6     | Finitions, test du `.exe` installé, doc complète, v1.0.0                                                                                                                                                                                | ⏳          |

## Plus tard (hors V1, la structure doit le permettre)

- **Upload YouTube direct** depuis l'app : générer → publier en un clic (emplacement prévu dans `youtube-video`).
- **Instagram** : stats et publication de Reels via l'API Instagram de Meta (compte Créateur/Professionnel + app Meta développeur). Futur module `instagram-stats`, compte géré par `ctx.accounts`.
- **SoundCloud** : stats via l'API officielle (abonnement Artist Pro requis pour obtenir des identifiants). Futur module `soundcloud-stats`.
- **Tableau de bord unifié** multi-plateformes par morceau.
- **Styles visuels** multiples, couleurs extraites automatiquement de la cover.
- **Pulsation de la cover sur les basses**, si elle n'est pas assez fiable pour la V1 (la V1 utilise un zoom lent).
- **Démarrage avec Windows et icône dans la zone de notification**, pour que les relevés planifiés tournent même sans ouvrir l'app.
- **Intégration des apps existantes** (outil mails, boîte à outils gamifiée to-do/timer/habitudes/XP) en tant que modules adaptés au contrat.
- **Mise à jour automatique** de l'app.
- Signature du code (supprimerait l'avertissement SmartScreen) si l'app est un jour distribuée.
