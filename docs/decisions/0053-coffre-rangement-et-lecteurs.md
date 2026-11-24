# 0053 — Coffre : fenêtre de rangement, aperçu et registre de lecteurs

- Statut : acceptée (v0.45.0, module marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md`, `modules/coffre/README.md`

## Contexte

Ranger doit coûter presque rien : un fichier glissé doit arriver dans une fenêtre déjà remplie, qu'on valide d'une touche. Retrouver doit être immédiat : voir un fichier sans l'ouvrir, passer au suivant. Les formats à montrer vont s'allonger (v0.47 et après) : ajouter un format ne doit rien toucher d'autre. Rien ne doit partir en ligne, même en ouvrant une page web enregistrée.

## Décision

1. **Glisser n'importe où sur une page du Coffre** ouvre la fenêtre de rangement (`frame.tsx`). Le dépôt sur une tuile ou sur la page d'un contexte fixe ce contexte (« choisi »). Pas de dépôt global dans tout le socle en v0.45 : ce serait un changement du socle pour un seul module (règle d'or) ; il reste possible plus tard par un mécanisme générique.
2. **Rien n'est écrit avant « Ranger »** : `/deposit/analyze` propose, `/deposit/apply` écrit ; Entrée = Ranger ; « Ranger plus tard » = Arrivée ; « Tout valider » range chacun selon sa proposition (sans proposition : Arrivée ; un doublon reste de côté tant qu'il n'est pas « gardé quand même »). Chaque écriture rend un « Annuler ».
3. **Registre de lecteurs** (`frontend/readers/registry.ts`) : un lecteur déclare ses extensions, ses tailles maximales (aperçu et miniature), sa priorité et son composant ; chaque fichier `*.reader.tsx` s'enregistre seul et `readers/index.ts` les charge tous (`import.meta.glob`). Ajouter un lecteur = ajouter un fichier (test avec un lecteur factice).
4. **Bibliothèques locales, empaquetées** (en `devDependencies`, bundlées par Vite) : `pdfjs-dist` 6.5.438 (PDF ; son worker est un fichier de l'app, servi par le serveur local), `highlight.js` 11.12.0 (coloration, seulement les langues choisies), `markdown-it` 15.0.3 (`html: false`, images désactivées, liens jamais suivis). Toutes publiées depuis plus de deux semaines ; `npm audit` ne leur trouve rien.
5. **HTML isolé** : cadre `sandbox=""` (aucun script, aucun formulaire, origine à part) et politique `default-src 'none'` placée en tête de la page : aucune requête (images, feuilles de style, polices distantes) et aucun script. Vérifié dans l'app réelle (aucune requête observée, le script de la page ne s'exécute pas).
6. **Pas de WebAssembly** : la politique de l'interface reste inchangée (`'wasm-unsafe-eval'` non ajouté). Conséquence : pdf.js n'affiche pas les images JPEG 2000 et remplace les polices non incluses. Accepté pour v0.45, à revoir si un PDF de cours en souffre.
7. **Ctrl+K** sur une page du Coffre = recherche du Coffre (écouteur en phase de capture, avant celui de la barre latérale) ; ailleurs, inchangé.
8. **Double-clic** sur une carte = ouvrir dans l'application ; un clic sur l'aperçu attend 260 ms (`ReliefCard`) pour ne jamais ouvrir l'aperçu avant un double-clic.

## Conséquences

- Les composants « atelier » du SDK (`packages/sdk/atelier.tsx`) servent aux pages du Coffre et à tout module qui en a besoin.
- Un format sans lecteur montre l'icône de sa nature et « Ouvrir dans son application » : jamais une erreur.
- Une recherche « dans tout le socle » (Ctrl+K global sur le contenu des modules) demanderait un contrat de recherche du socle : pas en v0.45.
