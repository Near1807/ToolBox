# 0034 — Analyse du master : mesures maison vérifiées contre ebur128, cache par contenu, intégrations facultatives

- Statut : acceptée
- Date : 2026-10-24

## Contexte

Thomas veut mesurer ses masters pendant la production (sonie, crêtes, bandes, stéréo, sections, versions, références) sans que l'outil touche jamais à l'audio ni donne de conseils, et sans qu'aucun autre module en dépende.

## Décision

- **Nouveau module `master-analysis`**, section Musique, sans dépendance obligatoire (Bibliothèque en service facultatif ; il fournit `masterAnalysis`, lui aussi facultatif pour les autres).
- **Mesures en TypeScript** sur les échantillons décodés par FFmpeg (32 bits flottants, à la fréquence du fichier, jusqu'à 96 kHz) plutôt qu'en lisant les sorties texte d'`ebur128` : toutes les courbes à 100 ms (10 ms pour la forme d'onde et la crête vraie) permettent de mesurer n'importe quelle partie (sections modifiées, zoom, versions alignées) avec le même code, côté serveur et interface (`shared/measures.ts`). Vérification : tests contre `ebur128` à ±0,1.
- **Crête vraie** : sinc fenêtré (Kaiser, 48 points par phase, ×4) plutôt que le filtre de 12 points donné en exemple par BS.1770-4 : ce dernier lit jusqu'à +0,2 dB de trop dans les aigus ; le nôtre lit la vraie crête d'un sinus à 0,01 dB près jusqu'à 19 kHz.
- **Copie des fichiers** (`ctx.outputs`, type `source`) et **cache par contenu** (SHA-256) : un même fichier n'est jamais réanalysé ; les analyses (recalculables) sont hors de la sauvegarde.
- **Projets** = morceau de la Bibliothèque ou analyse libre ; rattachement par `ctx.outputs.attach` (le module suit dans `onReattach`).
- **Dossier surveillé** désactivé par défaut, en lecture seule (copie seulement), regroupement par nom de fichier, morceau proposé et non imposé.
- **Vérification avant génération** : `precheckTrack(ctx, track)` (SDK, backend) et `usePrecheck` (SDK, interface), utilisés par Vidéo YouTube, Pack Insta et Reels perso ; jamais bloquante (« Générer quand même ») ; sans le module, rien ne change ; désactivable dans les réglages du module.
- **Sauvegarde avant suppression demandée** : nouveau `ctx.db.backup(reason)` du SDK (même rotation que les sauvegardes d'avant migration), utilisé par les Stats YouTube (ADR 0033).
- **Normalisation des plateformes** dans un réglage texte : les valeurs non officielles sont dites comme telles.

## Conséquences

- Analyse un peu plus lente que FFmpeg seul (~6 s pour 4 min dans le conteneur de test), en tâche de fond.
- La Bibliothèque et ce module se référencent mutuellement en facultatif : chacun cherche le service de l'autre au moment de l'utiliser (l'ordre de chargement est libre).
- Aucune action de l'assistant qui modifie : trois lectures seulement.
