# ToolBox sur Android (`mobile/app/`)

Étape 3b de la version téléphone (ADR 0044). La vraie appli : **ToolBox**, identifiant **`be.toolbox.app`**.

> **Cet identifiant ne change plus jamais.** Android reconnaît une mise à jour à son identifiant et à sa clé de signature. Les changer obligerait à désinstaller l'appli, et donc à perdre ses données.

## Ce qu'elle contient

- **Coquille mobile** (`src/App.tsx`) :
  - Accueil, To-do et Réglages, avec une navigation en bas ;
  - une seule colonne, des zones tactiles d'au moins 44 px ;
  - les thèmes du PC (Nebula par défaut, choix gardé sur le téléphone) ;
  - icônes lucide du SDK, aucun emoji.
- **Écrans des modules** : ceux du PC, sans changement. Une mise en page mobile est ajoutée par des fichiers CSS à part (`modules/todo/frontend/todo.mobile.css`, `src/mobile.css`), chargés seulement par l'appli.
- **Worker** (`src/worker.ts`) :
  - SQLite WebAssembly sur OPFS (VFS `opfs-sahpool`, pool `toolbox`, fichier `/toolbox.sqlite3`) ;
  - l'hôte téléphone (`packages/phone/`), qui fait tourner le code serveur des modules tel quel.
- **Démarrage à vide** : aucune donnée n'est livrée avec l'appli.
- **Filet de sauvegarde** (`src/backup.ts`, règles dans `packages/phone/backup.ts`) :
  - une copie par jour, à l'ouverture, dans le stockage propre de l'appli (plugin Filesystem, `Directory.Data`) ;
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
- `@capacitor/filesystem` 8.1.5.

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
| 1.0.0   | 1000000     |

Il croît toujours tant que le correctif reste sous 100 et la mineure sous 10 000 ; la CI refuse sinon. Deux APK de la même version ont le même versionCode : pour mettre à jour le téléphone, il faut une nouvelle version.
