# 0022 — Tout élément généré appartient à un projet (le morceau)

- Statut : acceptée
- Date : 2026-10-21

## Contexte

Vidéos, Reels, posts, miniatures et bientôt Reels perso sont générés par des modules différents. Pour préparer une sortie, Thomas doit voir au même endroit tout ce qui existe pour un morceau, savoir où en est chaque élément, et choisir ce qui part.

## Décision

- **`subject` devient obligatoire** dans `ctx.outputs.register` : c'est le projet de l'élément. Le socle reste générique (une chaîne) ; dans la section Musique, le projet est le morceau de la Bibliothèque, `music-library:track:<id>`. Un enregistrement sans projet est refusé.
- **La page du morceau devient la vue projet** : tous les éléments générés (de tous les modules, via `bySubject`), groupés par type, avec leur état. L'état « généré » vient du registre ; « planifié / programmé / publié » vient des modules qui le savent, par un fournisseur enregistré auprès de la Bibliothèque (`registerProjectStatus`, même schéma inversé que `registerTrackInfo`) : le plus avancé l'emporte.
- **« Inclure dans la sortie »** : une case par élément sur la page projet, stockée par la Bibliothèque (`music_library__project_items`, absent = inclus). Le Planning de sortie la lit par le service (`isIncluded`) et ne propose que les éléments cochés.
- **Éléments sans projet** : ceux sans `subject` (anciennes versions) ou dont le morceau a été supprimé. Les modules ré-enregistrent leurs fichiers au démarrage avec le morceau source, ce qui rattache automatiquement tout ce dont l'origine est connue. Le reste est listé dans « Sans projet » de la Bibliothèque : rattacher à un morceau (`ctx.outputs.attach`, choix conservé même quand le module ré-enregistre le fichier : colonne `subject_manual`, migration 4 du socle) ou supprimer (Corbeille, avec confirmation).

## Conséquences

- ~~Rattacher un élément sans projet ne change que son projet dans le registre : les données propres du module (ex. la ligne d'une vidéo) gardent leur morceau d'origine, qui n'existe plus.~~ Corrigé en v0.13 par l'ADR 0025 : chaque module suit le rattachement (`ctx.outputs.onReattach`).
- Aucune donnée n'est supprimée par les migrations : elles ajoutent une colonne ou une table.
