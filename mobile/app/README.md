# ToolBox sur Android (`mobile/app/`)

Étapes 3b, 4, 5a et 5b de la version téléphone (ADR 0044), plus l'Agenda (v0.34.0). La vraie appli : **ToolBox**, identifiant **`be.toolbox.app`**.

> **Cet identifiant ne change plus jamais.** Android reconnaît une mise à jour à son identifiant et à sa clé de signature. Les changer obligerait à désinstaller l'appli, et donc à perdre ses données.

## Ce qu'elle contient

- **Coquille mobile** (`src/App.tsx`) :
  - navigation en bas, 5 entrées : Accueil, Courses, To-do, Sport, « Plus » (Agenda, Boîte à idées, Timer, Réglages) ;
  - Accueil : une carte par module installé ;
  - la liste des modules est à un seul endroit par côté : `src/server-modules.ts` (Worker) et `src/page-modules.ts` (page) ;
  - une seule colonne, des zones tactiles d'au moins 44 px ;
  - les thèmes du PC (Nebula par défaut, choix gardé sur le téléphone) ;
  - icônes lucide du SDK, aucun emoji.
- **Écrans des modules** (To-do, Courses, Sport, Boîte à idées, Timer, Agenda) : ceux du PC. L'Agenda montre sur le téléphone une vue jour par jour (glisser pour changer de jour) au lieu de la semaine. Une mise en page mobile est ajoutée par des fichiers CSS à part (`modules/<id>/frontend/<id>.mobile.css`, `src/mobile.css`), chargés seulement par l'appli. Les rares écarts de comportement passent par `onPhone()` du SDK (toujours faux sur le PC) : pas de clavier à l'arrivée sur la To-do, séance ouverte amenée à l'écran (Sport), import JSON remplacé par une phrase et « Prendre une photo… » (Courses).
- **Barre « Ajouter »** (v0.36.0, ADR 0046) : un « + » flottant au-dessus de la barre du bas ouvre la même barre que sur le PC (`@hub/sdk/quick-add`), avec les destinations des modules présents.
- **Ce que seule la page peut faire** (`src/page-host.ts`, canal inverse Worker → page) : « Enregistrer sous » = feuille de partage d'Android (greffons Filesystem + Share).
- **Timer** (`src/timer-notices.ts`, `src/TimerPhone.tsx`) : notifications des fins de phase **programmées à l'avance** (greffon Local Notifications, alarmes exactes si permises), permission demandée avec une phrase, alarmes exactes vérifiées à chaque ouverture, guide Samsung.
- **Synchro avec le PC** (`src/SyncPage.tsx`, `src/phone-sync.ts`, logique dans `packages/phone/sync-client.ts`) : appairage, première synchro, synchro à la main, Conflits ; le PC retrouvé sur tout réseau (adresses connues, greffon `PcFinder` = NSD, « Nouvelle adresse du PC ») ; photos des recettes ; **synchro automatique** (`src/auto.ts`, `packages/phone/auto-sync.ts`, désactivée par défaut) avec le canal direct (greffon `LiveChannel`, OkHttp). Toutes les requêtes vers le PC passent par un certificat épinglé (`PinnedHttp`).
- **Notification permanente du Timer** (`src/timer-ongoing.ts`, greffon `TimerOngoing` + `TimerOngoingReceiver`) : volet et écran de verrouillage, compte à rebours natif, phases enchaînées par AlarmManager, reconstruite après redémarrage ; réglage dans Réglages (activé par défaut).
- **Fichiers des modules** (`src/opfs-files.ts`) : images des recettes dans OPFS (`files/`), hors des copies de sauvegarde.
- **Worker** (`src/worker.ts`) :
  - SQLite WebAssembly sur OPFS (VFS `opfs-sahpool`, pool `toolbox`, fichier `/toolbox.sqlite3`) ;
  - l'hôte téléphone (`packages/phone/`), qui fait tourner le code serveur des modules tel quel.
- **Démarrage à vide** : aucune donnée n'est livrée avec l'appli.
- **Filet de sauvegarde** (`src/backup.ts`, règles dans `packages/phone/backup.ts`) :
  - une copie par jour, à l'ouverture, dans le stockage propre de l'appli (plugin Filesystem, `Directory.Data`) ;
  - une copie « avant-migration » quand une mise à jour doit migrer une base non vide : le Worker attend cette copie avant de migrer (si elle échoue, rien n'est migré) ;
  - chaque fiche compte les éléments par module (tâches, idées, séances, recettes…) ;
  - les 7 plus récentes sont gardées, jamais celle d'une base vide ;
  - si la base est vide ou absente et qu'une copie existe, l'appli **propose** de la restaurer, avec une confirmation. Jamais de restauration automatique.
- **Sauvegarde Android vers le cloud désactivée** (`android:allowBackup="false"`) : rien ne part en ligne.

## Construire

**APK signé** : par la CI, `.github/workflows/android.yml`.

- Il part à chaque push sur `hub-v1` qui touche ce qui tourne sur le téléphone, ou à la main une fois le fichier sur `main`.
- Il signe avec la clé de l'appli (les 4 secrets `ANDROID_*`) et refuse de construire s'il en manque un.

**En local, pour la page seule** : `npm ci` à la racine et ici, puis `npm run build` et `npm run preview` (http://localhost:4180). Chrome y offre OPFS.

L'appli prend React, Vite, le SDK et sqlite-wasm à la racine du dépôt, avec une seule copie de React. Elle n'installe ici que Capacitor :

- `@capacitor/core`, `android` et `cli` 8.5.3 ;
- `@capacitor/app` 8.1.2 ;
- `@capacitor/filesystem` 8.1.5 ;
- `@capacitor/share` 8.0.3 ;
- `@capacitor/local-notifications` 8.3.1 (déclare `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED` : les notifications programmées survivent à un redémarrage).

## versionCode

Android n'installe une mise à jour que si son `versionCode` est **plus grand** que celui de l'appli installée. Il est calculé à partir de la version de ToolBox (`package.json` de la racine, la même pour le PC et le téléphone) :

```
versionCode = majeure × 1 000 000 + mineure × 100 + correctif
```

| Version | versionCode |
| ------- | ----------- |
| 0.30.0  | 3000        |
| 0.30.1  | 3001        |
| 0.31.0  | 3100        |
| 0.34.0  | 3400        |
| 0.35.0  | 3500        |
| 1.0.0   | 1000000     |

Il croît toujours tant que le correctif reste sous 100 et la mineure sous 10 000 ; la CI refuse sinon. Deux APK de la même version ont le même versionCode : pour mettre à jour le téléphone, il faut une nouvelle version.
