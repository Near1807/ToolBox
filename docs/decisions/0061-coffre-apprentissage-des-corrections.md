# 0061 — Coffre : apprendre des choix et des corrections de Thomas

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règles 1 et 9), ADR 0053

## Contexte

Les déductions de v0.45 (extension, Mark of the Web, mots du nom ↔ contextes et cours, année) ne tiennent pas compte de ce que Thomas fait ensuite : s'il range toujours les fichiers d'un site dans « Réseaux », ou corrige la nature d'un PDF de Thermo en « synthèse », le Coffre doit le proposer la fois suivante, et le dire.

## Décision

- **Règles simples**, sans modèle ni IA : `site → contexte`, `mot du nom (ou code de cours) → contexte`, `extension dans un contexte → nature`. Mots retenus : 3 lettres au moins, ni nombre, ni année, ni mot vide (« copie », « final »…), 8 au plus par nom.
- **Apprentissage** à chaque placement fait par Thomas : un dépôt (proposition acceptée ou corrigée), un changement de contexte (`PATCH`), une nature choisie (`PUT /attributes`). La règle qui donne la même valeur est **confirmée** (+1) ; celles de même clé qui donnent une autre valeur sont **corrigées** (+1). Arrivée : rien n'est appris sur le contexte.
- **Confiance** = confirmations / (confirmations + corrections). Une règle ne propose qu'à partir de **2 confirmations** et **66 %** ; elle passe avant les déductions de v0.45 (elle vient des choix de Thomas) ; sa raison est visible au survol (« 3 fichiers de ce site rangés dans « Cours › Réseaux » (appris) »).
- **Une valeur « choisie » n'est jamais remplacée** : les règles ne donnent que des valeurs « devinées » ; `mergeGuesses` garde les choix de Thomas (testé).
- Table `coffre__rules` (migration 5, ajout seulement), **prête pour la synchro** (UUID, dates, suppressions logiques, journal, `SyncStore`).
- Réglages › Coffre › « Ce que le Coffre a appris » : la liste (clé, ce qu'elle propose, confiance, confirmée / corrigée), modifier ce qu'une règle donne (elle devient sûre), supprimer, **« Tout oublier »** (confirmé ; suppressions logiques). Rien de tout cela ne touche un élément : seulement les propositions futures.

## Conséquences

- Actions sans clic : l'écriture des règles accompagne un geste de Thomas (ranger, déplacer, choisir) ; aucune n'est appliquée sans lui (une proposition s'accepte par « Ranger »).
- Pour changer les seuils : `MIN_HITS`, `MIN_CONFIDENCE` dans `modules/coffre/shared/learn.ts`.
