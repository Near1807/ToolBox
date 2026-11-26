# 0066 — Tâches de fond : plus jamais de page figée

- Statut : acceptée (v0.49.0, nouveautés marquées « Expérimental »)
- Date : 26/11/2026
- Référence : `docs/MODULES.md` §5.5 bis ; rapport v0.49.0 (diagnostic mesuré)

## Contexte

En déposant plusieurs fichiers ou un gros dossier (projet React avec `node_modules`), la page du Coffre se figeait sans rien dire, parfois longtemps, et un dépôt échouait parfois sans créer de fichier. Diagnostic mesuré :

1. **Une requête qui attend la fin du travail.** L'analyse et le rangement étaient chacun une seule requête qui ne répondait qu'une fois tous les fichiers lus (empreintes), copiés et relus. Pendant ce temps : une petite mention « Analyse… », aucun compte, aucune annulation. Avec un projet React « fichiers un par un » : 50 s d'attente, puis 52 902 propositions.
2. **Une liste trop longue d'un coup.** La fenêtre de rangement dessinait 52 902 lignes : page gelée 6,3 s d'affilée.
3. **Tout ou rien.** Une seule erreur (un fichier verrouillé ou déplacé, un chemin refusé) défaisait tout le lot : « les fichiers ne sont pas créés ».
4. **Des lectures de dossier synchrones** sur le fil du serveur (comptage, aperçu d'import, dossiers trouvés) : le serveur ne répondait plus le temps du parcours, proportionnel au nombre de fichiers (Windows et son antivirus le rendent bien plus long que les mesures faites ici).
5. **`node_modules` compté, empreinté et copié** avant toute question.

## Décision

- **Règle** (`docs/MODULES.md` §5.5 bis) : toute opération qui peut durer plus d'une seconde est une tâche de fond ; la requête rend la main tout de suite avec `{ jobId }`, l'interface suit le flux d'événements des tâches ; jamais une requête qui attend la fin.
- **Socle, générique** (`backend/core/jobs.ts`, migration 8 du socle, par ajout seulement : `details`, `state`) :
  - `job.step(done, total, { unit, current })` : le compte et l'élément en cours ; le socle calcule la fraction et le temps restant ;
  - `job.problem(item, raison)` : chaque élément qui échoue est listé, les autres continuent ;
  - `retry` : « Réessayer ceux-là » (`POST /api/core/jobs/:id/retry`) ;
  - `resumable` + `job.checkpoint(état)` : remise en file au démarrage suivant, depuis le point de reprise ; les autres tâches sont « interrompues » avec ce qu'elles avaient fait ;
  - le résultat est gardé même après une annulation (ce qui était fait, son « Annuler »).
- **Interface, générique** (`packages/sdk/jobs-ui.tsx`) : `JobCard`, `waitForJob` ; témoin dans la barre latérale (Tâches) ; avertissement à la fermeture de ToolBox (fenêtre et « Quitter » de la zone de notification).
- **Coffre** :
  - en tâches : analyse et rangement d'un dépôt, aperçu et import d'une arborescence, déplacement et fusion de contextes, archivage et réactivation ;
  - mise à jour, vérification et restauration du disque l'étaient déjà ;
  - la lecture des textes est montrée dans le panneau des tâches du Coffre (au-dessus des deux onglets) ;
  - fichiers lus de façon asynchrone ; dossiers recréables écartés avant de compter ;
  - au-delà de 20 000 fichiers ou 20 Go, la question vient d'abord.

## Conséquences

- Les routes concernées répondent `{ jobId }` (les tests attendent la tâche).
- Les vérifications rapides (refus, chemins, confirmations) restent faites avant la mise en file : un refus répond tout de suite.
- Le nouveau modèle du Coffre (v0.50) pourra s'appuyer sur ces outils sans les changer.
