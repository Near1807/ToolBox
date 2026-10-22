# 0024 — Services facultatifs : un module n'exige que ce sans quoi il n'a aucun sens

- Statut : acceptée
- Date : 2026-10-22

## Contexte

En v0.12, le Planning de sortie déclarait comme dépendances obligatoires tous les modules dont il lit les éléments : Vidéo YouTube, Pack Instagram, Reels perso et le moteur vidéo. Désactiver « Reels depuis mes vidéos » désactivait donc aussi le Planning, alors qu'il garde tout son sens sans Reels perso.

## Décision

- **Règle** : un module ne déclare en dépendance obligatoire (`dependsOn.modules`, `dependsOn.services`) que ce sans quoi il n'a aucun sens ; tout le reste est facultatif.
- **Le socle gère les services facultatifs** : `dependsOn.optionalServices` dans `module.json`, lus avec `ctx.services.optional<T>(nom)`, qui renvoie `undefined` si aucun module chargé ne fournit le service (absent, désactivé ou en erreur). Le fournisseur présent est chargé avant le consommateur ; un lien facultatif ne bloque jamais un module, et il est ignoré pour rompre un cycle.
- **Le Planning** n'exige plus que la Bibliothèque : une sortie est celle d'un morceau. Les générateurs sont facultatifs ; sans l'un d'eux, ses éléments ne sont jamais proposés, et le plan le dit. `GET /summary` renvoie `features` pour que l'interface cache ce qui en dépend. Sans moteur vidéo, la vidéo longue part avec la miniature automatique de YouTube.
- **Les générateurs** (Vidéo YouTube, Pack Instagram, Reels perso) gardent la Bibliothèque et le moteur vidéo en obligatoire : sans morceau ni rendu, ils n'ont rien à faire.

## Conséquences

- Un module qui utilise un service facultatif doit fonctionner sans lui : c'est testé (Planning avec la seule Bibliothèque, puis avec la seule Vidéo YouTube).
- Un module chargé reste chargé si un fournisseur facultatif est activé plus tard : il le voit au prochain démarrage, comme toute activation de module.
