# Ajouter un module

Guide pratique. Les règles complètes sont dans [MODULES.md](MODULES.md) : à relire avant de commencer.

## 1. Copier le modèle

```bash
cp -r modules/_template modules/mon-outil
```

L'id (`mon-outil`) est en kebab-case, unique, et **identique au nom du dossier**. Il sert de préfixe partout :

| Où         | Exemple pour `mon-outil`        |
| ---------- | ------------------------------- |
| API        | `/api/modules/mon-outil/...`    |
| Tables     | `mon_outil__...`                |
| Événements | `mon-outil:...`                 |
| Fichiers   | `<userData>/modules/mon-outil/` |

## 2. Remplir `module.json`

- `id` → `mon-outil` ; `name`, `description` en français ; `version` → `1.0.0`.
- `section` → la section de l'accueil (ex. `Musique`) ; `icon` → un emoji ; `order` → position dans la section.
- `dependsOn` / `provides` → les modules et services nécessaires / fournis (sinon, supprimer les listes vides). **N'exiger que ce sans quoi le module n'a aucun sens** ; ce qui n'est qu'utile va dans `dependsOn.optionalServices` et se lit avec `ctx.services.optional()` (MODULES.md §5.8).
- `settings` → les réglages à afficher dans la page Réglages (ou `[]`).

## 3. Écrire le backend (`backend/index.ts`)

1. **Migrations** : remplacer celle du modèle. Tables nommées `mon_outil__xxx` (ou `${db.table('xxx')}` dans une migration fonction). Version 1 pour commencer.
2. **`register(ctx)`** : déclarer les routes (`ctx.routes`), tâches longues (`ctx.jobs.define`), tâches planifiées (`ctx.scheduler.schedule`), services (`ctx.services.provide`), écouteurs (`ctx.events.on`).
3. **Fichiers générés** (vidéo, image, export…) : écrits dans `ctx.files.outputDir()` et **toujours** enregistrés avec `ctx.outputs.register(...)` — avec leur **projet** (`subject`, obligatoire : en Musique `music-library:track:<id>`, le morceau source) — plus un `ctx.outputs.onRemoved(...)` qui efface les données liées du module et un `ctx.outputs.onReattach(...)` qui déplace ses lignes quand l'utilisateur rattache un fichier « Sans projet » à un autre projet. C'est obligatoire (MODULES.md §5.13) : sans cela, l'utilisateur ne peut ni les supprimer ni voir qu'ils ont disparu. Exemple : la route `/notes/:id/export` du modèle.
4. Erreurs utilisateur → `throw new HttpError(400, 'message en français')`.
5. Si le module fournit un service : décrire son interface dans `contract.ts` (types uniquement).
6. **Actions pour l'assistant vocal** (obligatoire, MODULES.md §5.15) : `ctx.assistant.define(...)`. Au minimum une action de lecture (« où en est… ? »). Une action qui modifie (`change` avec `undo`, `destructive` avec `confirmation`) seulement sur décision explicite de Thomas (MODULES.md §1 bis) ; `sensitive` : jamais exécutée, avec `page`. Exemples : `count-notes` et `add-note` du modèle, `todo` pour un module complet.
7. **Contrôle et sécurité** (MODULES.md §1 bis) : confirmation avant toute suppression, publication ou modification en ligne ; tout ce qui agit seul est désactivé par défaut, avec un réglage clair.

Supprimer tout ce qui ne sert pas (route de démo, tâche planifiée…).

## 4. Écrire le frontend (`frontend/index.tsx`)

- Une page principale `{ path: '', component: MaPage }` ; d'autres pages si besoin (`'details/:id'`).
- `useModule()` pour appeler son backend (`module.api.post('/x', data)`), `useApi(module.url('/x'))` pour charger des données, `useJobs(module.id)` pour suivre ses tâches.
- Composants du SDK (`Page`, `Card`, `Button`…) pour rester homogène avec le reste de l'app. Éléments générés : **composants partagés** `OutputCard`, `MediaThumb`, `FileActions`, `PublishedCheck`, `StateBadge`, `CopyButton`, `ExcerptWaveform`… et tous ceux de `docs/MODULES.md` §7.1, obligatoires.
- CSS du module : mise en page et variables du thème uniquement (`var(--accent)`, `var(--surface-2)`…), **aucune couleur en dur** — `npm run lint` le vérifie. Liste des variables : `docs/THEMES.md`.
- Fichiers générés : `<OutputList module={module.id} />` donne une liste complète (ouvrir, supprimer avec confirmation, sélection multiple, fichiers introuvables). Pour une présentation sur mesure (vignettes…), utiliser `outputs.delete/forget`, `confirmDelete`, `useSelection` + `SelectionBar` et `MissingFile`.
- Pas de frontend ? Supprimer le dossier `frontend/` (module de service).

## 5. Tester

- Adapter `tests/` : `createTestHub` + `loadModuleFolder` démarrent un vrai socle avec le module.
- Tester au minimum : chargement sans erreur, chaque route, les erreurs prévues, les migrations sur une base existante si le module évolue, et pour les fichiers générés : présence dans `/api/core/outputs`, suppression, fichier effacé à la main (signalé introuvable).

```bash
npm test            # rapide ; npm run test:full si un rendu a changé (la CI la lance toujours)
npm run lint        # vérifie aussi les frontières du module
npm run typecheck
```

## 6. Essayer dans l'app

```bash
npm run dev         # à relancer après l'ajout d'un dossier de module
```

Le module apparaît sur l'accueil dans sa section, et dans la navigation. Son état (et ses éventuelles erreurs) est visible dans Réglages > Modules ; ses journaux dans la page Journaux.

## 7. Documenter et livrer

- `modules/mon-outil/README.md` : rôle, tables, fichiers, réglages, événements émis/écoutés, services fournis/consommés, routes.
- `CHANGELOG.md` (section « Non publié ») et `docs/ROADMAP.md`.
- Commit, push sur la branche de travail ; le `.exe` est produit par la CI (`npm run dist:win` sous Windows).

**Faire évoluer un module existant** : ne jamais modifier une migration publiée, en ajouter une (version suivante). Incrémenter `version` dans `module.json`.

**Retirer un module** : supprimer son dossier, rebuild. Ses données restent dans `hub.db` et `<userData>/modules/<id>/` (rien n'est effacé) ; s'il est réinstallé plus tard, il les retrouve.

---

## Intégrer une app existante

Objectif : porter une ancienne application (ex. l'outil de mails, la boîte à outils gamifiée) dans le hub **en l'adaptant au contrat de module, sans jamais modifier le socle pour elle**. Si quelque chose semble manquer au socle, c'est d'abord une question à poser (cela profiterait-il à tous les modules ?) et, si oui, une évolution générique du contrat, documentée ici et dans un ADR, jamais un cas particulier.

### Étape 1 — Inventaire de l'ancienne app

Lister, sur papier, ce que fait l'app et ce qu'elle utilise :

| Dans l'ancienne app                                                | Devient dans le hub                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Serveur HTTP / IPC Electron / appels directs au disque depuis l'UI | Routes `ctx.routes` sous `/api/modules/<id>/` ; l'UI n'appelle que ces routes              |
| Sa propre base (SQLite, JSON, localStorage, IndexedDB)             | Tables préfixées dans `hub.db` via des migrations ; import des anciennes données (étape 4) |
| Fichiers dans son propre dossier                                   | `ctx.files.dataDir` (privé) ou `ctx.files.outputDir()` (fichiers pour l'utilisateur)       |
| Fichier de configuration, variables d'environnement                | `settings` du manifest (`secret` pour les mots de passe et clés)                           |
| Identifiants OAuth, jetons                                         | `ctx.accounts` (jamais stockés par le module lui-même)                                     |
| Minuteurs, cron, rappels                                           | `ctx.scheduler` (avec rattrapage) ou `ctx.jobs`                                            |
| Traitements longs                                                  | `ctx.jobs` (progression, annulation)                                                       |
| Logs (`console.log`, fichiers)                                     | `ctx.logger`                                                                               |
| Appels à une autre app                                             | Services (`ctx.services`) ou événements (`ctx.events`)                                     |
| Routeur, layout, menu, thème propres                               | Pages du module dans le shell (`pages`, `nav`, `HomeWidget`), composants et styles du SDK  |
| Dépendances npm                                                    | Ajoutées au `package.json` du hub (en `devDependencies` si elles sont bundlées)            |

Ce qui n'a pas d'équivalent n'est pas une raison de toucher au socle : chercher d'abord comment l'exprimer avec le contrat.

### Étape 2 — Créer le module

Copier `modules/_template` vers `modules/<id>/`, choisir la section (ex. `Productivité`), remplir le manifest. Si l'app est grosse, la découper en **plusieurs modules** qui communiquent par services (ex. `todo`, `timer`, `habits`, et un module `xp` qui écoute leurs événements pour attribuer de l'expérience).

### Étape 3 — Porter le code

1. **Logique métier** (fonctions pures) : copier dans `modules/<id>/backend/`, sans dépendance à Electron ni au DOM. C'est la partie la plus réutilisable.
2. **Accès aux données** : réécrire en requêtes `ctx.db.prepare(...)` sur les tables préfixées. Schéma dans `migrations`.
3. **API** : chaque action de l'ancienne UI devient une route.
4. **Interface** : porter les composants React (ou réécrire les vues si l'app n'était pas en React) dans `frontend/`. Remplacer les appels directs (IPC, fs, fetch vers l'ancien serveur) par `module.api`. Retirer le layout global : le shell fournit la navigation. Remplacer les couleurs de l'ancienne app par les variables du thème (`docs/THEMES.md`) et ses cartes / boutons de fichiers par les composants partagés du SDK.
5. Vérifier `npm run lint` : il signale toute importation interdite restante (electron, autre module, socle).

### Étape 4 — Reprendre les données existantes

Écrire une route ou une tâche d'**import** dans le module (ex. bouton « Importer depuis l'ancienne app » qui demande le fichier ou le dossier de l'ancienne base) :

- lire l'ancien format, écrire dans les tables du module, dans une transaction ;
- copier les fichiers utiles dans `ctx.files.dataDir` ;
- ne **jamais** modifier ni supprimer les données de l'ancienne app (l'utilisateur les supprimera lui-même une fois satisfait) ;
- rendre l'import rejouable sans doublons (ou le refuser s'il a déjà été fait) ;
- avant d'importer en vrai : « Exporter une sauvegarde » depuis les Réglages.

### Étape 5 — Tester et documenter

Tests du module (dont l'import sur un échantillon de données de l'ancienne app, anonymisé, placé dans `tests/fixtures/`), README du module, CHANGELOG, ROADMAP. L'ancienne application reste utilisable en parallèle jusqu'à ce que le module la remplace complètement.
