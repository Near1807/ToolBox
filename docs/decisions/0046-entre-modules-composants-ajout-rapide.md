# 0046 — Entre modules : composants prêtés et destinations « Ajouter »

- Statut : acceptée (v0.36.0)
- Date : 13/11/2026

## Contexte

Thomas veut agir là où il voit une chose, sans changer d'écran. Trois cas :

- modifier une tâche **depuis l'Agenda**, avec exactement les champs et les règles de la To-do ;
- lancer un timer **depuis l'Agenda** (ou une autre fiche) ;
- **ajouter** une tâche, un rendez-vous ou une idée **depuis n'importe où**, par une barre du shell.

Le contrat interdit d'importer le code d'un autre module (seuls les types de `contract.ts`), et le shell ne doit connaître aucun module. Copier le formulaire de la To-do dans l'Agenda ferait deux formulaires qui divergent.

## Décision

Deux ajouts au contrat **côté page** (`FrontendModule`), tous les deux facultatifs :

1. **`provides`** : un module **prête** des composants, par un nom (`'todo.taskEditor'`, `'timer.launch'`).
   - Leurs props sont des types du `contract.ts` du prêteur.
   - L'emprunteur écrit `<Lent name="todo.taskEditor" props={…} fallback={…} />` et sait s'il est disponible par `useLentAvailable(name)` : sans le module prêteur, rien n'est affiché (le bouton disparaît).
   - Le composant tourne **dans le contexte de son module** (`ModuleProvider` du prêteur) : son `useModule()` et son API sont les siens. Il n'écrit donc que ses propres données, par ses propres routes.
2. **`quickAdd`** : la **destination** d'un module dans la barre « Ajouter » du shell :
   - libellé, icône, ordre ;
   - `preview(texte, aujourd'hui)` pur ;
   - `add(texte, { api })` avec l'API du module, qui rend un message, et un lien et une annulation quand c'est possible.

   Le shell (PC et téléphone) liste les destinations des modules présents et ne connaît aucun module.

Le shell donne la liste des modules **chargés** (`PresentModulesProvider`) : un module absent ou désactivé ne prête rien et n'a pas de destination.

Côté serveur, rien de nouveau dans le socle. Les actions passent par les **services** existants, complétés par ajouts : `todo.deleteTask` (pour « Annuler ») et, partie B, le lancement d'un timer.

## Conséquences

- Un seul formulaire de tâche (`TaskFields`), utilisé par la liste de la To-do et par la fiche prêtée.
- Le prêteur reste maître de ses données : l'emprunteur ne fait qu'afficher le composant et recevoir un message (avec son « Annuler »).
- Un nouveau module peut prêter un composant ou déclarer une destination sans toucher au shell.
- Limite : un composant prêté ne connaît que les props de son contrat. S'il doit évoluer, son contrat évolue par ajouts, comme un service.
