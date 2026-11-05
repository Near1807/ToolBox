# Appli d'essai OPFS (`mobile/probe/`)

Étape 3a de la version téléphone (ADR 0044). Elle répond à une seule question : **SQLite en WebAssembly avec la VFS `opfs-sahpool` garde-t-il les données dans le WebView de Capacitor 8, sur le Galaxy S21 ?**

- **Identifiant** `be.toolbox.probe` : distinct de la future vraie appli, jamais en conflit avec elle.
- **Projet à part** : il a son `package.json` et ses versions épinglées, et n'importe rien de l'app PC. Il n'est **jamais livré dans le .exe**.
- **Aucune donnée personnelle** : seulement un compteur de lancements et des lignes d'essai.
- **Aucun repli** : sans OPFS, la page le dit et indique ce qui manque ; rien n'est enregistré ailleurs.

## Ce que fait la page

- À chaque ouverture, elle ajoute une ligne dans `lancements`.
- Elle affiche : le nombre de lancements, la VFS utilisée et si elle est persistante, `createSyncAccessHandle` dans le Worker, `navigator.storage.persist()` / `persisted()`, la version du WebView et d'Android, la version de l'appli (versionCode).
- **Écrire 1 000 lignes** (avec le temps), **Tout relire** (temps et nombre), **Copier le rapport**.

## Construire

- **APK** : par la CI, `.github/workflows/android-probe.yml`. Il est lancé par un push sur `hub-v1` qui touche ce dossier, ou à la main une fois le fichier sur `main`. Les versionCode 1 et 2 sont construits dans le même run, avec la même clé de debug.
- **Page seule, dans un navigateur** : `npm ci`, `npm run build`, `npm run preview`, puis http://localhost:4173. Chrome y offre OPFS.
- **Android en local** : il faut le SDK Android et le JDK 21. Lancer `npx cap sync android`, puis `cd android && ./gradlew assembleDebug -PprobeVersionCode=1`.

Le projet `android/` a été généré par `npx cap add android`. Seul `app/build.gradle` est modifié : le versionCode vient de `-PprobeVersionCode`.
