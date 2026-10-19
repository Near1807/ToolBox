# 0010 — Sécurité des données : sauvegardes, restauration, export

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Les données (bibliothèque de morceaux, historique de statistiques impossible à reconstituer) s'accumulent sur des années. Les migrations de schéma, écrites par différentes sessions, sont le principal risque de perte.

## Décision

- **Avant toute migration en attente** (socle ou module), copie horodatée de `hub.db` dans `<userData>/backups/` via `VACUUM INTO` (copie cohérente même en mode WAL). Les **10 dernières** sont conservées. Pas de copie pour une base créée au même lancement (rien à protéger).
- Chaque migration s'exécute dans une transaction. **En cas d'échec** : restauration de la sauvegarde (fermeture, remplacement du fichier, réouverture), **désactivation persistante** du module avec le message d'erreur (`core__module_state`), démarrage normal du reste. Le module ne redémarre qu'après réactivation explicite dans les Réglages.
- Une base plus récente que le module (retour à une ancienne version) désactive le module sans rien toucher.
- **Règle de contrat** : un module ne supprime jamais de données existantes sans migration explicite (MODULES.md §6).
- **Export manuel** (Réglages > Sauvegardes) : `.zip` (yazl, en flux) contenant une copie cohérente de `hub.db`, les dossiers `modules/*` de `userData` et un fichier descriptif. Les vidéos générées n'en font pas partie (elles sont dans le dossier de sortie, et volumineuses).
- **Journaux en fichiers** (`userData/logs/`) et non en base : ils doivent survivre à une restauration, précisément quand on en a besoin.

## Conséquences

- Restaurer une sauvegarde automatique ou un export se fait à la main, app fermée (procédure dans `docs/WINDOWS.md`). Une restauration depuis l'interface pourra venir plus tard.
- Les sauvegardes occupent de l'espace (10 × taille de la base) : acceptable, la base reste petite (les fichiers audio/images sont à part).
