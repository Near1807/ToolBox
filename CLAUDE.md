# ToolBox — guide pour les sessions Claude Code

> À lire en premier. Court, exact, à jour : si tu changes quelque chose de décrit ici, mets ce fichier à jour dans le même commit.

## Le projet

Application de bureau Windows personnelle de Thomas : un **hub** (page d'accueil + navigation) qui donne accès à des **modules** (outils). V1 : espace « Musique » (bibliothèque de morceaux, générateurs de vidéos YouTube/Instagram, statistiques YouTube : `youtube-stats`) et section « Outils » (To-do, Assistant vocal local). Thomas pilote, Claude code. État d'avancement : `docs/ROADMAP.md`.

**Règle d'or : le socle reste générique, les modules s'adaptent au socle.** Le socle ne connaît aucun module en particulier (ni la musique, ni YouTube). Une ancienne app intégrée plus tard s'adapte au contrat de module ; on ne modifie jamais le socle pour elle.

**Pour ajouter ou modifier un module : lire `docs/MODULES.md` (le contrat) puis `docs/AJOUTER-UN-MODULE.md`.** Point de départ : copier `modules/_template/`.

Modules actuels (section Musique) : `music-library` (bibliothèque, service `musicLibrary`), `video-engine` (moteur FFmpeg partagé, Reels dessinés image par image, service `videoEngine`, sans page), `youtube-video` (générateur 16:9), `instagram-video` (pack Insta : 4 Reels 9:16 au même style sobre, post 4:5, légende, suivi de publication, service `instagramPack`), `custom-reels` (Reels 9:16 faits avec les vidéos de l'utilisateur, banque d'effets Brut/Calme/Rythme/Ciné/Caméra embarquée, son au choix : morceau, vidéo ou morceau synchronisé, service `customReels`), `release-planner` (planning de sortie : calendrier, upload et programmation YouTube via `ctx.accounts`, rappels Instagram, service `releasePlanner`), `youtube-stats` (stats YouTube stockées en local, croisées avec les morceaux ; Labo, théories avec niveau de confiance, mode démo ; aucun service). `youtube-video` fournit le service `youtubeVideo`. Section Outils : `todo` (tâches, tags, échéances en langage naturel, morceau facultatif) et `assistant` (assistant vocal 100 % local : whisper.cpp, Piper, Ollama facultatif ; commandes standardisées sans IA par défaut, interrupteur « IA », dictionnaire modifiable ; talkie-walkie, indicateur flottant ; utilise les actions de tous les modules, ADR 0029, 0030). Chaque module a son `README.md`.

## Contrôle et sécurité (prioritaire sur toute autre considération)

- **La solidité et le contrôle de Thomas passent AVANT l'autonomie et le côté spectaculaire.** En cas de doute : demander, ou ne pas faire.
- **Jamais sans confirmation explicite de Thomas** :
  - supprimer des données ou des fichiers ;
  - publier ou envoyer quoi que ce soit en ligne ;
  - modifier quelque chose déjà en ligne ou programmé ;
  - écraser une donnée existante ;
  - lancer une mise à jour de l'app ou d'un modèle.
- **Toute action qui modifie quelque chose est visible** (confirmation à l'écran ou à voix haute) et, quand c'est possible, **annulable**.
- **Droits ajoutés un par un.** L'assistant vocal et toute automatisation future (envoi automatique, tâches planifiées…) n'obtiennent de nouveaux droits qu'un par un, sur décision explicite de Thomas, après une période de test. Par défaut, toute nouvelle capacité est **désactivée ou en lecture seule**.
- **Livré désactivé.** Toute nouvelle fonctionnalité qui agit seule est d'abord livrée **désactivée par défaut**, avec un réglage clair pour l'activer.
- **Vue d'ensemble dans chaque rapport.** Chaque rapport de fin de session a une section qui liste toute action pouvant modifier, supprimer ou publier sans clic de Thomas (même avec confirmation vocale).

Détail pour les modules : `docs/MODULES.md` §1 bis.

## Stack

- Electron 44 (coquille) → lance dans son process principal un backend **Fastify** sur `127.0.0.1` (port aléatoire en prod, 47321 en dev).
- Frontend **React 19 + Vite 8 + TypeScript**, routeur `react-router` (HashRouter). Il ne parle au backend **que via l'API REST** (client dans `@hub/sdk/frontend`).
- **SQLite** via `better-sqlite3` (N-API, aucun rebuild pour Electron), base unique `hub.db` dans `app.getPath('userData')`.
- **FFmpeg/FFprobe** embarqués : `ffmpeg-static` + `@derhuerst/ffprobe-static` (même build ; FFmpeg **6.1** sous Windows, 7.0 sous Linux : rester compatible 6.1), dépaquetés de l'asar.
- **Canvas** `@napi-rs/canvas` (Skia, N-API précompilé, dépaqueté de l'asar) : rendu des Reels image par image (ADR 0017).
- **Touche globale** `uiohook-napi` (N-API précompilé, dépaqueté de l'asar) : touche maintenue « parler » de l'assistant, même sans le focus (ADR 0028).
- **Embeddings** `onnxruntime-web` (WebAssembly, aucun module natif ; seuls le build Node et son `.wasm` sont empaquetés) + `@huggingface/tokenizers` (bundlé) : reconnaissance des commandes standardisées de l'assistant (ADR 0030).
- Secrets et jetons OAuth chiffrés avec `safeStorage` via l'interface `HostAdapter` (`backend/core/host.ts`). Comptes connectés (`ctx.accounts`, OAuth Google installé : boucle locale + PKCE, ADR 0018) ; notifications Windows et zone de notification (ADR 0019).
- Qualité : ESLint 10 + Prettier, Vitest 5, TypeScript 6 (pas 7 : non supporté par typescript-eslint). zod (manifests), yazl (export .zip).

## Commandes

| Commande                                   | Rôle                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                              | Vite + backend + Electron avec rechargement. UI aussi ouvrable sur http://localhost:5173. **À relancer après l'ajout d'un dossier de module** |
| `TOOLBOX_LOAD_EXAMPLES=1 npm run dev`      | Idem, en chargeant aussi les modules d'exemple (`modules/_*`)                                                                                 |
| `npm run build` / `npm start`              | Build (`build/renderer`, `build/main`) / lance Electron sur le build                                                                          |
| `npm test` / `npm run test:watch`          | Tests rapides Vitest (socle dans `tests/`, modules dans `modules/*/tests/`), sans les rendus complets (~20 s)                                 |
| `npm run test:full`                        | Suite complète, dont les rendus complets (`fullRenderTests`) ; toujours lancée par la CI Windows                                              |
| `npm run lint` / `npm run format`          | ESLint (dont la règle des frontières de modules) + Prettier + aucune couleur en dur dans l'interface (`check:ui-colors`)                      |
| `npm run typecheck`                        | `tsc --noEmit`                                                                                                                                |
| `npm run check:native`                     | Vérifie que better-sqlite3, @napi-rs/canvas et uiohook-napi se chargent dans le Node d'Electron (sous Linux : `xvfb-run -a`)                  |
| `npm run dist:win`                         | Installateur NSIS + portable dans `dist/` (sous Windows, ou via la CI)                                                                        |
| `node scripts/smoke-test.mjs <exe> [args]` | Auto-test d'un build (API, SQLite, FFmpeg, canvas, module modèle, UI)                                                                         |

Sous Linux en root (conteneur) : ajouter `--no-sandbox` à Electron, et `xvfb-run -a` pour un écran virtuel. Pour voir l’interface : Playwright (`_electron.launch`, s’il est installé dans l’environnement) permet de piloter l’app et de faire des captures.

## Structure

```
electron/        process principal : fenêtre (plein écran, barre sombre), zone de notification et démarrage avec Windows, preload, HostAdapter Electron, smoke test
backend/         server.ts (Fastify) · core/ (hub.ts = chargeur de modules et ctx, migrations, sauvegardes,
                 réglages, tâches, planificateur, événements, services, fichiers générés, comptes, notifications, journaux) · routes/core.ts (/api/core/*)
frontend/src/    shell React : modules/ (découverte, hôte des pages), shell/ (barre latérale à catégories, accueil, fichiers générés, tâches, journaux, réglages), themes/ (un fichier par thème), styles.css
packages/sdk/    @hub/sdk : backend.ts, frontend.tsx, components.tsx (composants partagés), manifest.ts, testing.ts — seul import autorisé aux modules
modules/         un dossier par module ; _template/ = module modèle (exemple, chargé à la demande)
scripts/         dev, build (esbuild + découverte des modules), smoke test, vérification native
tests/           tests Vitest du socle
docs/            ARCHITECTURE, MODULES (contrat), AJOUTER-UN-MODULE, DIRECTION-ARTISTIQUE (visuels générés), THEMES (interface), ROADMAP, WINDOWS, decisions/ (ADR), rapports/ (rapport de fin de session)
site/            site public statique (accueil + confidentialité, exigés par Google OAuth), publié par GitHub Pages depuis hub-v1
```

## Documentation de référence

- `docs/MODULES.md` — **le contrat de module** (la pièce la plus importante).
- `docs/AJOUTER-UN-MODULE.md` — guide pas à pas, dont « Intégrer une app existante ».
- `docs/ARCHITECTURE.md` — vue d'ensemble, démarrage, API du socle, sécurité, données.
- `docs/DIRECTION-ARTISTIQUE.md` — **règles obligatoires pour tout visuel généré** (sobriété, cover toujours entière, vérification sur trois covers).
- `docs/THEMES.md` — thèmes de l'interface : tokens, ajouter un thème (sans rapport avec les visuels générés).
- `docs/ROADMAP.md` — fait / en cours / prévu. `CHANGELOG.md` — versions.
- `docs/decisions/` — ADR : pourquoi chaque choix structurant.

## Conventions

- Code, identifiants et commentaires **en anglais** ; interface et documentation **en français**.
- TypeScript strict partout. Imports sans extension (bundlers). Alias `@hub/sdk/*` → `packages/sdk/*`.
- `dependencies` = uniquement ce que le process principal charge à l'exécution sans le bundler (natif, binaires, Fastify). Tout ce qui est bundlé (React, zod, yazl…) va en `devDependencies`.
- Tout appel API passe par `/api/...` avec l'en-tête `x-toolbox-token`. Les routes SSE (EventSource) utilisent un ticket à usage unique (`POST /api/core/stream-tickets`, puis `?ticket=`) et déclarent `streamTicket: true`.
- Le backend n'importe jamais `electron` : il passe par `HostAdapter`.
- Données utilisateur uniquement sous `userData`, jamais dans le dossier d'installation.
- **Tout fichier généré passe par `ctx.outputs` et est supprimable depuis l'interface** (Corbeille, sélection multiple, « Fichier introuvable »). `docs/MODULES.md` §5.13.
- **Tout est lié à un projet** : `subject` est obligatoire dans `ctx.outputs.register` ; en Musique, c'est le morceau source (`music-library:track:<id>`). La page du morceau est la vue projet (état généré / planifié / programmé / publié, case « Inclure dans la sortie » lue par le Planning). Éléments sans projet : section « Sans projet » de la Bibliothèque (rattacher ou supprimer) ; tout module qui enregistre des fichiers déclare `ctx.outputs.onReattach` pour déplacer ses propres lignes. ADR 0022, 0025.
- **Cohérence de l'interface** : les éléments générés (carte, miniature, case « Publié », boutons Supprimer/Régénérer/Dossier, forme d'onde des extraits, champs de texte) passent par les **composants partagés du SDK** (`packages/sdk/components.tsx`, `docs/MODULES.md` §7.1), jamais par une copie dans un module.
- **Thèmes** : couleurs, arrondis, ombres et polices de l'interface = variables CSS des thèmes (`frontend/src/themes/`, `docs/THEMES.md`). Aucune couleur en dur dans le shell ni dans les modules (`npm run lint` le vérifie). Les thèmes concernent l'interface ; les visuels générés suivent la direction artistique.
- Visuels : respecter `docs/DIRECTION-ARTISTIQUE.md` (sobre ; cover toujours entière, jamais recadrée ni étirée ; seuls mouvements lents de l'image entière ; couleurs de la cover). Vidéos de l'utilisateur (`custom-reels`) : banque d'effets permise (un fichier par effet), sans jamais masquer le contenu. Pixels carrés (`setsar=1`) en fin de chaîne, son ≤ -1 dBTP (≤ -1,1 dBTP pour les Reels perso). **Tout mouvement est piloté directement par le son, jamais par des événements détectés** (synchro mesurée, ≤ 1 image).
- **Données : une migration publiée ne se modifie jamais ; aucune suppression de données hors migration explicite** (ou demande explicite de l'utilisateur dans l'interface, avec confirmation). Le socle sauvegarde `hub.db` avant chaque migration et restaure en cas d'échec (`docs/MODULES.md` §6).
- **Assistant** : chaque module expose ses actions (`ctx.assistant.define`, niveau de risque `read` / `change` / `destructive` / `sensitive`, appliqué par le socle). Une nouvelle action qui modifie (`change`, `destructive`) n'est ajoutée que sur décision explicite de Thomas (« Contrôle et sécurité ») et déclare **son propre droit** (`right`), désactivé par défaut. Chaque action déclare si possible ses phrases d'exemple (`examples`) et son extracteur de paramètres en code (`extract`) : commandes standardisées, sans IA. `docs/MODULES.md` §5.15, ADR 0028, 0030.
- **Dépendances** : un module n'exige (`dependsOn`) que ce sans quoi il n'a aucun sens ; le reste en `dependsOn.optionalServices` + `ctx.services.optional()`, et le module fonctionne sans. ADR 0024.
- Toute modification du contrat de module ou de l'architecture met à jour la doc **dans le même commit**. Nouvelle décision structurante → nouvel ADR.
- **Tests** : pendant une session, lancer les tests rapides (`npm test`). La suite complète (`npm run test:full`) tourne en CI à chaque push ; en local, seulement si un rendu (moteur, effets, générateurs) a été modifié. Un nouveau test de rendu complet se marque `describe.runIf(fullRenderTests)` (`docs/MODULES.md` §8).
- Fin de phase : mettre à jour `docs/ROADMAP.md` et `CHANGELOG.md`, versionnage sémantique (`package.json`).

## Hygiène du code

- Une **passe de nettoyage et d'audit** est recommandée toutes les 3 à 4 sessions de fonctionnalités, ou avant un gros nouveau module. Modèle : `docs/rapports/2026-10-22-v0.14.1.md`.
- Règle : **corrections sûres directement, risquées seulement proposées** (dans le rapport : problème, bénéfice, risque, effort, recommandation). Sûr = aucun changement visible pour Thomas : mêmes fonctions, mêmes rendus, mêmes données.
- Ce que la passe vérifie : contrat de module (imports entre modules hors `contract.ts`, tables d'autres modules, fichiers hors `ctx.outputs`, `onReattach`, dépendances obligatoires / optionnelles, couleurs en dur) ; code mort (fonctions, composants, routes, réglages, CSS, dépendances npm) ; doublons à remonter dans le SDK ou le socle ; sécurité (jeton, Host/Origin, tickets, chemins) ; tests instables ou lents ; documentation contredite par le code ; `npm audit` / `npm outdated` (mineures et correctifs seulement) ; processus FFmpeg et écouteurs non libérés.
- Colonnes de base inutilisées : jamais supprimées (pas de migration destructive) ; on retire le code qui les lit et on les documente dans le README du module.
- Preuve de non-régression : suite complète (`npm run test:full`), lint, typecheck, CI Windows verte ; rendus de référence avant / après (YouTube, Pack Insta, un Reel perso par mode de son) : son décodé identique (md5 du PCM), images équivalentes (PSNR du même ordre que deux rendus successifs du code d'avant : le grain aléatoire donne ~50 dB, ~42 dB pour l'effet Ciné) ; montée de version depuis la base de la version précédente.
- Outils utiles : `npx knip` (exports et fichiers inutilisés ; les points d'entrée découverts par les scripts de build sont des faux positifs), `npm audit`, `npm outdated`.

## Fin de session (obligatoire)

À la fin de **chaque** session de travail : rapport complet, enregistré dans `docs/rapports/AAAA-MM-JJ-vX.Y.Z.md` (commité avec le reste) **et affiché en entier** dans le résumé final. En français, clair et factuel : pas de formule creuse, pas de « tout est parfait » sans vérification ; tout ce qui n'a pas été testé en réel est marqué **« non testé en réel »**. Structure obligatoire, dans cet ordre :

1. **Résumé** : 3 à 5 lignes, ce qui a été fait et l'état général (tout fonctionne / points bloquants).
2. **Ce qui a été fait** : par chantier, ce qui est livré, avec les fichiers / modules principaux touchés.
3. **Ce qui n'a pas été fait ou seulement en partie**, et pourquoi.
4. **Décisions prises sans Thomas** : chaque choix fait en autonomie, avec la raison et comment le changer.
5. **Écarts par rapport à la demande** : tout ce qui diffère de ce qui a été demandé.
6. **Bugs trouvés** : corrigés ou non, avec leur impact.
7. **Vérifications** : tests (nombre, résultats), lint, typecheck, CI Windows (lien du run), mesures (ffprobe, ebur128, synchro, temps de rendu), captures et planches contact.
8. **À tester sur le PC de Thomas** : liste numérotée, pas à pas, avec le résultat attendu.
9. **Risques et points à surveiller** : limites connues, dette technique, choses fragiles.
10. **Actions sans clic de Thomas** : liste complète et à jour de tout ce qui peut modifier, supprimer ou publier sans un clic de Thomas (même avec une confirmation vocale), avec son état (activé ou non par défaut) et ce qui a changé dans la session.
11. **Données et migrations** : migrations exécutées, impact sur les données existantes, sauvegardes créées.
12. **Commits** : commits poussés (hash + message) et version de l'app.
13. **Prochaines étapes suggérées** : 3 au maximum, par ordre de priorité.

Modèle : le dernier rapport de `docs/rapports/`.

## Git

- Travail sur la branche `hub-v1`. **Jamais** de push, merge ou rebase sur `main` : Thomas décide des fusions.
- Un commit par étape logique, messages clairs. Push à la fin de chaque phase au minimum. La CI construit le `.exe` à chaque push sur `hub-v1`.
- Aucun secret dans le dépôt (`.env` ignoré, `.env.example` documenté). Les identifiants OAuth (ID client, secret) se saisissent dans les réglages de l'app, jamais en dur.
