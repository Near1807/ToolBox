# Feuille de route

Légende : ✅ fait · 🚧 en cours · ⏳ prévu

## V1 — espace Musique

| Phase | Contenu                                                                                                                                                                                                                                                                                                                                                                         | Statut      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0     | Squelette Electron + Fastify + React, scripts dev/build/test/lint, CI Windows qui produit un `.exe` testé, CLAUDE.md, docs et ADR initiaux                                                                                                                                                                                                                                      | ✅ (v0.1.0) |
| 1     | Socle : chargeur de modules, `ctx` (db, files, settings, jobs, scheduler, events, services, logger), accueil par sections, réglages auto-générés, journaux, `modules/_template`, contrat complet (`MODULES.md`, `AJOUTER-UN-MODULE.md`), sauvegardes automatiques avant migration + export .zip                                                                                 | ✅ (v0.2.0) |
| 2     | `music-library` : bibliothèque de morceaux (glisser-déposer, ffprobe, édition, mini-lecteur, service partagé)                                                                                                                                                                                                                                                                   | ✅ (v0.4.0) |
| 3     | `video-engine` (moteur de rendu partagé, aperçu, progression, annulation) + `youtube-video` (16:9, description)                                                                                                                                                                                                                                                                 | ✅ (v0.4.0) |
| 4     | `instagram-video` : **pack Insta** par morceau — 4 Reels 9:16 sur 4 extraits distincts choisis automatiquement (RMS, hors intro/outro) et ajustables avant le rendu, image de post 4:5, légende modifiable (modèle réglable, option par Reel), suivi de publication (« Publié » + date, page « À publier »), glisser les fichiers hors de l'app, régénération d'un seul fichier | ✅ (v0.6.0) |
| 4 bis | Correctif des vidéos déformées (pixels carrés, cover jamais étirée) ; Reels en 4 styles (Révélation, Coupes sur le rythme, Phrase d'accroche, Ambiance) sans spectre ; socle : registre `ctx.outputs` des fichiers générés (suppression vers la Corbeille, sélection multiple, fichiers introuvables, page « Fichiers générés ») appliqué à tous les modules                    | ✅ (v0.7.0) |
| 5     | `ctx.accounts` (OAuth Google), planificateur avec rattrapage, `youtube-stats`                                                                                                                                                                                                                                                                                                   | ⏳          |
| 6     | Finitions, test du `.exe` installé, doc complète, v1.0.0                                                                                                                                                                                                                                                                                                                        | ⏳          |

## Plus tard (hors V1, la structure doit le permettre)

- **Upload YouTube direct** depuis l'app : générer → publier en un clic (emplacement prévu dans `youtube-video`).
- **Instagram — Stories** : format 9:16 dédié dans le pack (extrait court + autocollant de lien), à côté des Reels et du post.
- **Instagram — publication directe** du pack via l'API Instagram de Meta (compte Créateur/Professionnel + app Meta développeur), avec programmation ; la case « Publié » serait alors cochée automatiquement. Stats dans un futur module `instagram-stats`, compte géré par `ctx.accounts`.
- **SoundCloud** : stats via l'API officielle (abonnement Artist Pro requis pour obtenir des identifiants). Futur module `soundcloud-stats`.
- **Tableau de bord unifié** multi-plateformes par morceau.
- **Styles visuels** supplémentaires (YouTube et Reels), couleurs extraites automatiquement de la cover ; détection de visages/sujets pour le recadrage des Reels (aujourd'hui : carte des détails de l'image).
- **Pulsation de la cover sur les basses** (la V1 utilise un zoom lent ; FFmpeg ne sait pas animer une image d'après l'audio sans pré-analyse, à faire avec un fichier `sendcmd` généré depuis l'enveloppe des basses).
- Remplacement du son d'un morceau existant (aujourd'hui : supprimer et réimporter).
- **Démarrage avec Windows et icône dans la zone de notification**, pour que les relevés planifiés tournent même sans ouvrir l'app.
- **Intégration des apps existantes** (outil mails, boîte à outils gamifiée to-do/timer/habitudes/XP) en tant que modules adaptés au contrat.
- **Mise à jour automatique** de l'app.
- **Restauration d'une sauvegarde depuis l'interface** (aujourd'hui : procédure manuelle, voir `docs/WINDOWS.md`).
- Reprise automatique des tâches interrompues par la fermeture de l'app (aujourd'hui : marquées « interrompues », à relancer).
- Signature du code (supprimerait l'avertissement SmartScreen) si l'app est un jour distribuée.
