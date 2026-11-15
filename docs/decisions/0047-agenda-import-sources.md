# 0047 — Agenda : importer un calendrier dans une source liée à des catégories

- Statut : acceptée (v0.37.0, fonction marquée « Expérimental »)
- Date : 15/11/2026

## Contexte

Thomas veut voir son horaire d'école (un export `.ics`) et d'autres calendriers dans l'Agenda, rangés dans des catégories que les interrupteurs montrent ou cachent (« Cours », « Examens »). Un horaire change pendant l'année : le réimporter doit **mettre à jour** sans doublon, et ne **rien supprimer** sans son accord. Les règles de contrôle s'appliquent : rien en ligne, rien d'écrit avant un aperçu, une sauvegarde, une annulation possible.

## Décision

1. **Une source par calendrier importé** (`agenda__sources`, prête pour la synchro) : nom, format (ics, csv, xlsx), nom du calendrier du fichier, correspondance « valeur du fichier → catégorie de l'Agenda » (une catégorie par défaut pour le reste), style du titre, colonnes d'un tableau, date du dernier import.
2. **Les événements importés sont des événements ordinaires** de l'Agenda (mêmes vues, charge, chevauchements, interrupteurs, synchro). Ils portent en plus leur source (`source_id`), leur **clé d'origine** (`origin_key`) et leur origine (`origin`, JSON : texte d'origine champ par champ, valeur de catégorie du fichier, valeurs écrites par le dernier import).
3. **Clé d'origine** : l'UID de l'ICS ; pour une occurrence d'un événement répété, « UID#AAAAMMJJ » (date d'origine de l'occurrence, comme RECURRENCE-ID). Tableau : la colonne identifiant (« id:… »), sinon titre + début (un cours déplacé apparaît alors comme disparu + ajouté, limite documentée).
4. **Les répétitions sont dépliées** en occurrences à l'import (pas de semaine type) : DAILY et WEEKLY avec COUNT, UNTIL, BYDAY multiples, INTERVAL, WKST, plus RDATE, EXDATE, RECURRENCE-ID. Le reste (mensuel, annuel, BYSETPOS…) n'est pas deviné : l'événement est listé en erreur avec sa ligne. Une règle sans fin s'arrête un an après aujourd'hui.
5. **Heures** : TZID par les données de fuseaux du système (Intl), sinon le VTIMEZONE du fichier ; « Z » = UTC ; tout est converti à l'heure locale de l'appareil qui importe. Une journée entière garde sa date (DTEND exclusif → dernier jour inclus).
6. **« Modifié par toi »** : l'événement est comparé aux valeurs écrites par le dernier import (`origin.imported`). S'il en diffère, c'est que Thomas l'a changé : un changement du fichier sur cet événement est proposé **décoché**. Un événement identique dans le fichier ne propose rien, même si Thomas l'a changé (sa version est gardée).
7. **Écriture** : aperçu sans écriture ; puis sauvegarde (`ctx.db.backup`), une transaction, rien d'écrit si rien n'est coché ; « Annuler l'import » (journal des opérations gardé 10 minutes en mémoire) ; un disparu n'est supprimé (suppression logique, restaurable) que coché.
8. **Import sur le PC seulement** ; le téléphone reçoit sources et événements par la synchro (les tables sont synchronisées comme les autres).
9. **Excel** : `fflate` 0.8.3 (zip pur JavaScript, aucune dépendance, publié le 16 mai 2026, sans vulnérabilité connue) pour le conteneur, et une petite lecture de la première feuille dans le module. Écartés : `xlsx` 0.18.5 sur npm (vulnérabilités connues, plus maintenu sur npm), `exceljs` (beaucoup de dépendances anciennes, pensé pour Node), `read-excel-file` (dernière version publiée deux jours avant, dépendances à mainteneur unique en plages ouvertes).
10. **Réglages d'un module** : nouveau point facultatif du contrat côté page, `settingsPanel: { label, component }`, affiché par le shell dans la section du module (Réglages › Agenda › Sources), dans le contexte du module. Le shell ne connaît toujours aucun module (MODULES.md §7.6).

## Conséquences

- Migration 4 de l'Agenda, par ajouts seulement (nouvelle table, trois colonnes vides par défaut).
- Changer la correspondance d'une source s'applique à ses événements, sauf à ceux dont Thomas a changé la catégorie.
- Supprimer une source met elle et ses événements en suppression logique (restaurable, sauvegarde avant).
- Plus tard (pas fait) : abonnement à une URL ICS.
