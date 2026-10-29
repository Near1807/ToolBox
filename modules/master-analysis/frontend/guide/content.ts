// Content of the built-in guide (French, shown as is). Plain data: the page
// renders it and searches it. Inline: **bold**, [[section-id|text]] = link to
// another section. A `shot` block shows a capture of the real interface with
// its numbered marks (positions measured by scripts/guide-captures.mjs, kept
// in shots.json). Keep it in step with the interface: any change of a view,
// a graph or a measure updates its section in the same commit (MODULES.md §7.4).

export type Block =
  | string
  | { list: string[] }
  | { steps: string[] }
  | { terms: [string, string][] }
  | { shot: string; caption: string; marks: { id: string; label: string }[] }
  | { note: string };

export interface GuideSection {
  id: string;
  title: string;
  /** Extra words for the search (synonyms, units). */
  keywords?: string;
  blocks: Block[];
}

export interface GuideChapter {
  id: string;
  title: string;
  sections: GuideSection[];
}

export const GUIDE: GuideChapter[] = [
  {
    id: 'demarrer',
    title: 'Prise en main',
    sections: [
      {
        id: 'prise-en-main',
        title: 'Prise en main en 5 minutes',
        keywords: 'début commencer premier pas importer',
        blocks: [
          'L’Analyse du master **mesure** ton master pendant la production. Elle ne modifie jamais tes fichiers : elle en fait une copie dans l’app et n’affiche que des chiffres et des écarts, sans conseil.',
          {
            shot: 'apercu',
            caption:
              'La page : projets à gauche, versions du projet, puis, en pleine largeur, l’analyse de la version choisie.',
            marks: [
              {
                id: 'projects',
                label: 'Projets : les morceaux de la Bibliothèque et les analyses libres',
              },
              { id: 'add', label: '« Ajouter une version… » (ou glisser un fichier sur la page)' },
              {
                id: 'versions',
                label: 'Versions du projet, avec leur résumé (sonie, crête vraie, PLR)',
              },
              { id: 'figures', label: 'Les chiffres clés de la version, en grand' },
              { id: 'player', label: 'Lecteur et seuil des dépassements' },
              { id: 'tabs', label: 'Les cinq vues de l’analyse' },
              { id: 'guide', label: 'Ce guide' },
            ],
          },
          {
            steps: [
              '**Choisis un morceau** dans la liste de gauche (ou « Nouvelle analyse libre… » en haut à droite pour un fichier sans morceau).',
              '**Ajoute ton master** : glisse le fichier WAV, FLAC, AIFF ou MP3 sur la page, ou « Ajouter une version… ». Pour un morceau de la Bibliothèque, « Analyser le fichier de la Bibliothèque » prend son fichier actuel.',
              '**Attends l’analyse** (quelques secondes pour un morceau de 4 min ; la progression est dans le badge et dans Tâches). Un fichier déjà analysé n’est pas refait.',
              '**Lis les chiffres clés** en grand, sous la liste : sonie intégrée, crête vraie, LRA, PLR, perte au mono, dépassements (voir [[lecture|Lire la page]]).',
              '**Lis la [[vue-ligne-de-temps|Ligne de temps]]** : clic = écouter à cet instant, survol = toutes les valeurs à cet instant. Les repères en bas montrent les crêtes, écrêtages, problèmes de phase et silences.',
              '**Passe aux [[vue-mesures-globales|Mesures globales]]** pour les chiffres du morceau entier (sonie intégrée, crête vraie, PLR…) et ce que feront les plateformes à la lecture.',
              'À la version suivante, ajoute le nouveau fichier au **même projet** : la vue [[vue-versions|Versions]] montre ce qui a changé, section par section.',
            ],
          },
          {
            note: 'Les petits « ? » à côté des graphes et des mesures ouvrent directement la bonne partie de ce guide. Ils se masquent dans les réglages du module.',
          },
        ],
      },
    ],
  },
  {
    id: 'vues',
    title: 'Les vues',
    sections: [
      {
        id: 'vue-projets',
        title: 'Projets et versions',
        keywords: 'liste morceau analyse libre rattacher renommer exporter supprimer html rapport',
        blocks: [
          'Un **projet** est soit un morceau de la Bibliothèque, soit une **analyse libre** nommée (un fichier qui n’est pas encore un morceau). Chaque projet a ses **versions** : v1, v2… datées et renommables.',
          {
            terms: [
              [
                'Glisser-déposer',
                'Un ou plusieurs fichiers sur la page : nouvelles versions du projet affiché.',
              ],
              [
                'Analyser le fichier de la Bibliothèque',
                'Analyse le fichier actuel du morceau ; une nouvelle version n’est créée que s’il a changé.',
              ],
              [
                'Rattacher',
                'Analyse libre : la relie à un morceau. Un morceau est proposé d’après le nom du fichier (« Obsidian v3.wav » → Obsidian).',
              ],
              ['Renommer', 'Le projet (analyse libre) ou la version.'],
              ['Relancer', 'Une analyse en erreur ou annulée.'],
              [
                'Exporter (HTML)',
                'Un rapport autonome (imprimable en PDF), enregistré comme fichier du projet.',
              ],
              [
                'Supprimer',
                'La copie de la version, vers la Corbeille, après confirmation. Ton fichier d’origine n’est jamais touché.',
              ],
            ],
          },
          'Le résumé de chaque version donne la sonie intégrée, la crête vraie, le [[plr|PLR]], le nombre de dépassements et d’écrêtages. « identique à v2 » signale un fichier au contenu identique à une autre version.',
        ],
      },
      {
        id: 'lecture',
        title: 'Lire la page : résumé, détail, écarts',
        keywords: 'résumé chiffres clés détail replié colonnes gras gris écart mise en avant',
        blocks: [
          'Sous la liste des projets, l’analyse de la version choisie occupe toute la largeur. Elle se lit de haut en bas :',
          {
            list: [
              '**Les chiffres clés en grand** : sonie intégrée, crête vraie, LRA, PLR, perte au mono, nombre de dépassements (au seuil choisi) et d’écrêtages. Toujours visibles, quelle que soit la vue.',
              '**Les vues**, rangées par question (Volume et dynamique, Crêtes et saturation, Fréquences, Stéréo et mono, Structure et sections, Fichier) : quelques chiffres d’abord, le reste sous « Voir le détail », replié par défaut.',
              '**Colonnes** et **Pistes affichées** : un clic ajoute ou retire une colonne ou une piste ; ton choix est retenu sur cet ordinateur.',
              '**Unités dans les en-têtes**, valeurs alignées à droite, une décimale en général (deux pour la corrélation, aucune pour les pourcentages).',
            ],
          },
          {
            terms: [
              [
                'En gras',
                'Un écart de 3 LU ou dB ou plus (10 points ou plus pour la largeur, 0,3 ou plus pour la corrélation).',
              ],
              [
                'En gris',
                'Un écart de moins de 1 (moins de 3 points de largeur, 0,1 de corrélation), ou une valeur manquante.',
              ],
            ],
          },
          'Cette mise en avant ne dit rien de plus que le chiffre : elle aide seulement l’œil à trouver les grands écarts. Elle concerne les écarts (« vs morceau », versions, références), jamais les valeurs elles-mêmes.',
        ],
      },
      {
        id: 'vue-ligne-de-temps',
        title: 'Ligne de temps',
        keywords: 'timeline zoom molette curseur survol pistes lecture afficher masquer',
        blocks: [
          'Toutes les courbes de l’analyse sur le même axe du temps, du début à la fin du fichier, avec le curseur de lecture. Par défaut, quatre pistes seulement : forme d’onde, sonie, énergie par bande et repères. Les autres s’affichent d’un clic sur leur nom ; ton choix est **retenu** sur cet ordinateur.',
          {
            shot: 'ligne-de-temps',
            caption: 'La ligne de temps, valeurs affichées au survol.',
            marks: [
              { id: 'zoom', label: 'Zoom +, Zoom −, Tout' },
              { id: 'toggles', label: 'Pistes affichées : un clic affiche ou masque une piste' },
              {
                id: 'overview',
                label:
                  'Vue d’ensemble : le fichier entier ; faire glisser la fenêtre pour se déplacer',
              },
              { id: 'sections', label: 'Sections (voir la vue Sections)' },
              { id: 'lanes', label: 'Les pistes, chacune avec son unité et sa légende' },
              { id: 'tip', label: 'Valeurs exactes à l’instant survolé' },
            ],
          },
          {
            terms: [
              ['Clic', 'Lecture à partir de cet instant.'],
              [
                'Survol',
                'Toutes les valeurs à cet instant : sonies, crête vraie (10 ms), bandes, facteur de crête, PLR, largeur, corrélation, perte au mono, repères.',
              ],
              ['Ctrl + molette', 'Zoom autour du pointeur (jusqu’à 1 s à l’écran).'],
              ['Maj + molette', 'Défiler dans le temps.'],
              ['Vue d’ensemble', 'Cliquer ou faire glisser pour déplacer la fenêtre du zoom.'],
              ['Pistes affichées', 'Un clic sur un nom affiche ou masque la piste (choix retenu).'],
              [
                'Bandes empilées',
                'Avec la piste Bandes : la part de chaque bande dans l’énergie au lieu de leurs niveaux.',
              ],
              [
                'Largeur d’une bande',
                'Avec la piste Largeur : ajoute la largeur stéréo d’une seule bande (en pointillés).',
              ],
            ],
          },
          'Pistes : [[forme-onde|forme d’onde]], [[sonie|sonie]], [[bandes|énergie par bande]], [[spectrogramme|spectrogramme]], [[facteur-crete|dynamique]], [[largeur|largeur stéréo]], [[correlation|corrélation de phase]], [[mono|compatibilité mono]], [[reperes|repères]] (légende des repères sous la ligne de temps).',
        ],
      },
      {
        id: 'vue-mesures-globales',
        title: 'Mesures globales',
        keywords: 'chiffres tableau morceau entier groupes volume crêtes fréquences stéréo fichier',
        blocks: [
          'Les chiffres du morceau entier, rangés par question. Chaque groupe montre d’abord quelques chiffres en grand ; le reste est replié sous « Voir le détail ».',
          {
            shot: 'mesures-globales',
            caption: 'Mesures globales, groupées par question.',
            marks: [
              { id: 'volume', label: 'Volume et dynamique, avec la normalisation des plateformes' },
              { id: 'peaks', label: 'Crêtes et saturation' },
              { id: 'freq', label: 'Fréquences' },
              { id: 'stereo', label: 'Stéréo et mono' },
              { id: 'detail', label: '« Voir le détail » : le reste, replié par défaut' },
            ],
          },
          {
            list: [
              '**Volume et dynamique** : [[sonie|sonie intégrée]], [[lra|LRA]], [[plr|PLR]], [[facteur-crete|facteur de crête]] ; la [[normalisation|normalisation des plateformes]] ; en détail, le RMS et les normes de mesure.',
              '**Crêtes et saturation** : [[crete-vraie|crête vraie]], [[ecretage|crête d’échantillon]], nombre de dépassements et d’écrêtages ; en détail, la liste des [[reperes|repères]] avec « Écouter » (une seconde avant).',
              '**Fréquences** : l’énergie de chaque [[bandes|bande]], seule et par rapport à la sonie ; en détail, le [[spectre|spectre moyen]].',
              '**Stéréo et mono** : [[correlation|corrélation]], [[largeur|largeur]], [[mono|perte au mono]] ; en détail, les mêmes par bande.',
              '**Structure et sections** : les sections avec leur début et leur sonie ; « Ouvrir la vue Sections » pour les modifier.',
              '**Fichier** : format, fréquence, résolution, canaux ; en détail, durée, silences, décalage continu ([[hygiene|hygiène technique]]).',
            ],
          },
        ],
      },
      {
        id: 'vue-sections',
        title: 'Sections',
        keywords: 'intro montée drop pause outro partie couper fusionner découpage colonnes',
        blocks: [
          'Le morceau découpé en parties : Intro, Montée, Drop, Pause, Outro ou Partie. Le découpage automatique part de la sonie, du bas et du haut du spectre, de la [[densite|densité]] et de la largeur. C’est un **point de départ** : tout se modifie.',
          {
            shot: 'sections',
            caption: 'Sections et contrastes.',
            marks: [
              { id: 'figures', label: 'Nombre de sections, la plus forte, la plus calme' },
              { id: 'tools', label: 'Couper au curseur, revenir à l’automatique' },
              { id: 'columns', label: 'Colonnes : afficher PLR, LRA, largeur ou densité' },
              { id: 'table', label: 'Une ligne par section : nom, limites, sonie, écart' },
              { id: 'contrasts', label: 'Contrastes de chaque section avec le morceau entier' },
            ],
          },
          {
            terms: [
              [
                'Nom',
                'Cliquer dans le champ pour renommer (les sections de même nom sont comparées dans [[vue-references|Références]]).',
              ],
              ['Début', 'Déplace la limite avec la section précédente (en secondes).'],
              [
                'Couper au curseur',
                'Coupe la section en cours de lecture à la position du lecteur.',
              ],
              ['Fusionner avec la suivante', 'Réunit deux sections.'],
              ['Revenir au découpage automatique', 'Oublie les modifications.'],
              [
                'Colonnes',
                'Par défaut : nom, début, fin, sonie et écart avec le morceau (« vs morceau », en LU). [[plr|PLR]], [[lra|LRA]], [[largeur|largeur]] et [[densite|densité]] s’ajoutent d’un clic (choix retenu).',
              ],
            ],
          },
          'Sur un écran étroit, le tableau devient une carte par section. Les **contrastes** sont un tableau (sections × sonie et bandes) ; les mêmes en barres sous « Voir les contrastes en barres ». Voir [[contrastes|Contrastes entre sections]] et [[lecture|Lire les écarts]].',
        ],
      },
      {
        id: 'vue-versions',
        title: 'Versions',
        keywords: 'comparer comparaison écart différence avant après',
        blocks: [
          'Compare la version affichée à une autre version du même projet, **alignées dans le temps** (voir [[alignement|Alignement]]). Tous les écarts sont « version affichée moins version comparée ».',
          {
            shot: 'versions',
            caption: 'Deux versions comparées.',
            marks: [
              { id: 'pick', label: 'Version comparée, décalage trouvé, réglage à la main' },
              { id: 'figures', label: 'Les écarts principaux, en grand' },
              { id: 'overlay', label: 'Sonie court terme des deux versions superposées' },
              { id: 'bands', label: 'Fréquences : écart de chaque bande' },
            ],
          },
          {
            list: [
              '**Écarts en grand** : sonie intégrée, crête vraie, PLR, LRA, perte au mono.',
              '**Volume et dynamique** : [[sonie-superposee|sonie court terme superposée]] ; « Voir toutes les différences globales » : chaque mesure des deux versions et l’écart.',
              '**Fréquences** : l’écart de chaque bande, en dB.',
              '**Structure et sections** : les écarts section par section (sections de la version comparée) ; largeur et bandes s’ajoutent par « Colonnes ». Cliquer un nom pour écouter.',
              '**Dans le temps** : la [[carte-differences|carte des différences]], repliée par défaut.',
            ],
          },
        ],
      },
      {
        id: 'vue-references',
        title: 'Références',
        keywords: 'profil référence comparaison sonie égale a/b',
        blocks: [
          'Compare ton master à des morceaux de référence, rangés en **profils** (par exemple « Club », « Lo-fi »). Les références sont copiées dans l’app et ne sont jamais modifiées. Sans référence, rien n’est bloqué.',
          {
            shot: 'references',
            caption: 'Un profil de références.',
            marks: [
              { id: 'profile', label: 'Profil, nouveau profil, ajouter des références' },
              {
                id: 'figures',
                label: 'Le master en grand, la moyenne des références en dessous',
              },
              { id: 'ab', label: 'Écoute A/B à volume égal' },
              { id: 'bands', label: 'Fréquences : écart par bande, à sonie égale' },
            ],
          },
          {
            list: [
              '**Chiffres** : sonie, crête vraie, PLR, LRA, largeur et corrélation du master (en grand) et de la moyenne des références (en dessous), sans mise à niveau.',
              '**Écoute A/B** : voir [[ecoute-ab|Écoute A/B]].',
              '**Fréquences** (spectre au tiers d’octave sous « Voir le détail ») et **Structure et sections** (PLR, largeur, bandes par « Colonnes ») : voir [[equilibre-references|Comparaison à sonie égale]].',
            ],
          },
        ],
      },
      {
        id: 'exports',
        title: 'Exporter une analyse',
        keywords:
          'export rapport html pdf imprimer résumé markdown copier csv json zip données enregistrer',
        blocks: [
          'Sous les chiffres clés, la ligne **Exporter** concerne la version affichée. Choisis d’abord ce qui est inclus : la version comparée (par défaut la précédente) et un profil de références (s’il a des références analysées). Les chiffres sont exactement ceux de la page ; aucune interprétation ni conseil n’est ajouté.',
          {
            terms: [
              [
                'Exporter le rapport (HTML)…',
                'Un seul fichier .html, enregistré où tu veux (boîte « Enregistrer sous »). Il s’ouvre dans n’importe quel navigateur, sans l’app ni internet, et s’imprime en PDF (Imprimer → Enregistrer au format PDF). Tous les chiffres y sont en texte et en tableaux ; les graphes sont des images intégrées.',
              ],
              [
                'Copier le résumé',
                'Copie un résumé compact en Markdown dans le presse-papiers : chiffres clés, plateformes, bandes, sections, contrastes, repères avec minutage, écarts avec la version comparée et les références. Pratique pour coller dans une conversation.',
              ],
              [
                'Exporter les données complètes…',
                'Un fichier .zip avec courbes.csv (une ligne par 100 ms : sonie, crêtes, bandes, largeur, corrélation, perte au mono, densité ; séparateur « ; ») et analyse.json (toutes les mesures).',
              ],
            ],
          },
          {
            note: 'Les exports ne sont pas rangés dans les fichiers du projet : ce sont tes fichiers, à l’endroit choisi. Si le fichier existe déjà, Windows demande avant de le remplacer.',
          },
        ],
      },
    ],
  },
  {
    id: 'mesures',
    title: 'Mesures et graphes',
    sections: [
      {
        id: 'forme-onde',
        title: 'Forme d’onde',
        keywords: 'waveform amplitude',
        blocks: [
          'L’amplitude du signal dans le temps (crêtes positives et négatives), de −1 à +1 (0 dBFS en haut et en bas). Elle montre la structure et les passages très compressés (bloc plat), pas la sonie perçue : pour cela, voir [[sonie|Sonie]].',
        ],
      },
      {
        id: 'sonie',
        title: 'Sonie (LUFS) : intégrée, momentanée, court terme',
        keywords: 'loudness lufs lu volume perçu bs.1770 ebu r128 intégrée momentanée court terme',
        blocks: [
          'La **sonie** est le volume perçu, mesuré selon la norme BS.1770-4 (filtre qui imite l’oreille). Unité : **LUFS** (plus c’est proche de 0, plus c’est fort) ; un écart de sonie s’exprime en **LU** (1 LU = 1 dB).',
          {
            terms: [
              [
                'Intégrée',
                'Le morceau entier en un chiffre (avec des portes qui ignorent les silences et passages très calmes). C’est elle que les plateformes comparent à leur cible.',
              ],
              ['Momentanée (400 ms)', 'Fenêtre courte : suit les coups et les accents.'],
              [
                'Court terme (3 s)',
                'Fenêtre de 3 s : suit le niveau des parties ; la courbe la plus lisible pour comparer des sections.',
              ],
            ],
          },
          'Sur la ligne de temps : court terme en trait plein, momentanée en second trait, intégrée en pointillés. Précision vérifiée contre l’outil `ebur128` de FFmpeg à ±0,1 LU.',
        ],
      },
      {
        id: 'lra',
        title: 'Plage de sonie (LRA)',
        keywords: 'loudness range lu variation',
        blocks: [
          'L’écart entre les parties calmes et les parties fortes du morceau (EBU Tech 3342), en **LU** : calculé sur la sonie court terme, entre le 10ᵉ et le 95ᵉ centile, sans les silences. Petit = niveau très constant ; grand = morceau contrasté. Par section, elle mesure la variation à l’intérieur de la section.',
        ],
      },
      {
        id: 'crete-vraie',
        title: 'Crête vraie (dBTP) et dépassements',
        keywords: 'true peak dbtp inter-sample intersample seuil dépassement',
        blocks: [
          'La **crête vraie** est le plus haut niveau du signal **entre** les échantillons, tel qu’un convertisseur ou un codeur (MP3, AAC, Opus) le reconstruira. Unité : **dBTP** (0 dBTP = pleine échelle). Elle peut dépasser la crête d’échantillon.',
          'Mesure : suréchantillonnage ×4 (×2 à 96 kHz et plus). Les **dépassements** sont les passages au-dessus du seuil (−1 dBTP par défaut, réglable dans les réglages et temporairement à côté du lecteur) : repères sur la ligne de temps, liste dans les Mesures globales.',
        ],
      },
      {
        id: 'ecretage',
        title: 'Crête d’échantillon et écrêtage',
        keywords: 'sample peak dbfs clipping saturation clip',
        blocks: [
          'La **crête d’échantillon** (dBFS) est la plus haute valeur des échantillons eux-mêmes. Un **écrêtage** est une suite d’échantillons collés à la pleine échelle (signal coupé net) ; le repère indique le canal et le nombre d’échantillons. « Échantillons au-delà de 0 dBFS » ne concerne que les fichiers en virgule flottante.',
        ],
      },
      {
        id: 'plr',
        title: 'PLR (crête vraie − sonie)',
        keywords: 'peak to loudness ratio dynamique compression',
        blocks: [
          'Le **PLR** est l’écart entre la crête vraie et la sonie, en **LU**. Global : crête vraie maximale − sonie intégrée. Sur la ligne de temps : sur 3 s (crête vraie − sonie court terme). Petit PLR = master dense, crêtes proches du niveau moyen ; grand PLR = crêtes qui dépassent nettement.',
        ],
      },
      {
        id: 'facteur-crete',
        title: 'Facteur de crête et RMS',
        keywords: 'crest factor rms dynamique piste',
        blocks: [
          'Le **facteur de crête** est l’écart entre la crête d’échantillon et le niveau RMS (moyen), en **dB**, sans pondération de l’oreille. Sur la ligne de temps (piste Dynamique) : sur 1 s, avec le PLR sur 3 s. Le **RMS** (dBFS) est le niveau moyen de l’énergie.',
        ],
      },
      {
        id: 'bandes',
        title: 'Énergie par bande',
        keywords: 'sub graves bas-médium médium haut-médium aigus air fréquences empilées',
        blocks: [
          'Le spectre est découpé en 7 bandes : **Sub** 20–60 Hz, **Graves** 60–250, **Bas-médium** 250–500, **Médium** 500–2 000, **Haut-médium** 2–6 kHz, **Aigus** 6–12 kHz, **Air** 12–20 kHz.',
          {
            terms: [
              [
                'Énergie (dB)',
                'Le niveau de la bande. Sur la ligne de temps, une courbe par bande (lissée).',
              ],
              [
                'Par rapport à la sonie',
                'Énergie de la bande − sonie intégrée : compare l’équilibre de deux morceaux sans tenir compte de leur volume.',
              ],
              [
                'Bandes empilées',
                'La part de chaque bande dans l’énergie totale (100 % en tout), instant par instant.',
              ],
            ],
          },
        ],
      },
      {
        id: 'spectrogramme',
        title: 'Spectrogramme',
        keywords: 'fréquence temps couleur',
        blocks: [
          'Les fréquences (de bas en haut, échelle logarithmique) dans le temps (de gauche à droite) ; la couleur donne le niveau : de la couleur du fond (faible, sous −100 dB) à la couleur d’accent, puis à celle du texte (le plus fort). Il montre où vit l’énergie : un sub continu, un filtre qui s’ouvre, des aigus coupés.',
        ],
      },
      {
        id: 'spectre',
        title: 'Spectre moyen et tiers d’octave',
        keywords: 'équilibre tonal spectrum fréquence courbe',
        blocks: [
          'Le niveau moyen de chaque fréquence sur tout le morceau, lissé au **tiers d’octave** (trait plein), et les 31 bandes de tiers d’octave de 20 Hz à 20 kHz (pointillés). Axe horizontal : fréquence (logarithmique) ; vertical : dB. À lire en relatif (une bosse, un creux, une pente), pas en valeur absolue.',
        ],
      },
      {
        id: 'largeur',
        title: 'Largeur stéréo',
        keywords: 'stéréo side mid width image',
        blocks: [
          'La part du **côté** (S, la différence gauche − droite) dans l’énergie, en %. **0 %** = mono (gauche = droite), **50 %** = gauche et droite sans lien, **100 %** = opposition totale. Globale, par bande (souvent étroite dans le sub), et dans le temps. « Largeur d’une bande » sur la ligne de temps ajoute la courbe d’une bande.',
        ],
      },
      {
        id: 'correlation',
        title: 'Corrélation de phase',
        keywords: 'phase opposition mono compatibilité',
        blocks: [
          'La ressemblance entre canal gauche et canal droit, de **−1 à +1** : **1** = identiques (mono), **0** = sans lien, **négatif** = en opposition (des éléments s’annulent en mono). Globale (pondérée par l’énergie, les silences ne comptent pas) et dans le temps. Repère « Problème de phase » : corrélation sous −0,2 pendant au moins 300 ms avec du son.',
        ],
      },
      {
        id: 'mono',
        title: 'Compatibilité mono (perte au mono)',
        keywords: 'mono somme téléphone enceinte perte',
        blocks: [
          'Le niveau de la somme mono (M) par rapport à la stéréo (M + S), en **dB** : **0 dB** = rien ne se perd en mono ; **−3 dB** = gauche et droite sans lien ; beaucoup plus bas = des éléments disparaissent en mono (téléphone, enceinte unique, club en mono). Globale, par bande et dans le temps.',
        ],
      },
      {
        id: 'reperes',
        title: 'Repères',
        keywords: 'marqueurs dépassement écrêtage phase silence liste',
        blocks: [
          {
            terms: [
              [
                'Crête vraie au-dessus du seuil',
                'Au-dessus du seuil des dépassements (voir [[crete-vraie|Crête vraie]]).',
              ],
              ['Écrêtage', 'Échantillons collés à la pleine échelle (voir [[ecretage|Écrêtage]]).'],
              [
                'Problème de phase',
                'Corrélation sous −0,2 pendant 300 ms ou plus (voir [[correlation|Corrélation]]).',
              ],
              ['Silence', 'Sous −60 dBFS pendant 500 ms ou plus.'],
            ],
          },
          'La légende de la piste donne le nombre de chaque type. La liste complète est dans les Mesures globales, avec « Écouter ».',
        ],
      },
      {
        id: 'densite',
        title: 'Densité (attaques par seconde)',
        keywords: 'attaques onsets rythme transitoires',
        blocks: [
          'Le nombre d’attaques (débuts de notes ou de coups détectés dans le spectre) par seconde, en moyenne sur la section. Elle distingue une partie chargée d’une partie aérée de même sonie.',
        ],
      },
      {
        id: 'normalisation',
        title: 'Normalisation des plateformes',
        keywords: 'spotify youtube apple music deezer soundcloud cible gain streaming',
        blocks: [
          'Chaque plateforme ramène les morceaux à sa **cible** de sonie à la lecture, sans changer le fichier. Le tableau donne la cible, le **gain** qu’elle appliquerait à ton master et la sonie qui en résulte.',
          {
            list: [
              '**Baissé et monté** (Spotify, Apple Music, SoundCloud) : un master trop calme est monté, mais seulement jusqu’au plafond de crête vraie (−1 dBTP par défaut) ; la note l’indique.',
              '**Seulement baissé** (YouTube, Deezer) : un master plus calme que la cible reste plus calme.',
              'Spotify et SoundCloud : valeurs de leurs pages d’aide. YouTube, Apple Music, Deezer : **non publiées officiellement**, valeurs mesurées par la profession, modifiables dans les [[reglages|réglages]].',
            ],
          },
        ],
      },
      {
        id: 'hygiene',
        title: 'Hygiène technique',
        keywords: 'format fréquence résolution bits canaux durée silence dc décalage continu',
        blocks: [
          {
            terms: [
              ['Format', 'Conteneur et codec ; « compressé avec perte » pour MP3, AAC, Opus…'],
              [
                'Fréquence, résolution, canaux',
                'Ceux du fichier ; plus de deux canaux sont mixés en stéréo pour l’analyse.',
              ],
              ['Silence au début / à la fin', 'Durée sous −60 dBFS.'],
              [
                'Décalage continu (DC)',
                'Une composante constante qui décentre la forme d’onde, par canal, en % de la pleine échelle.',
              ],
              [
                'Échantillons au-delà de 0 dBFS',
                'Possibles seulement en virgule flottante ; ils seraient écrêtés à l’export en entier.',
              ],
            ],
          },
        ],
      },
      {
        id: 'alignement',
        title: 'Alignement des versions (décalage)',
        keywords: 'décalage offset synchronisation confiance régler',
        blocks: [
          'Deux versions ne commencent pas forcément au même instant (silence ajouté, intro raccourcie). Le **décalage** est trouvé automatiquement en comparant les enveloppes de sonie, puis affiné à 10 ms ; la **confiance** (0 à 100 %) dit à quel point il est sûr.',
          'Si la confiance est faible ou le décalage faux, saisis-le dans « Régler » : « Garder ce décalage » l’enregistre (pour la comparaison avec la version précédente) ; « Revenir à l’automatique » l’oublie.',
        ],
      },
      {
        id: 'sonie-superposee',
        title: 'Sonie court terme superposée',
        keywords: 'courbes deux versions superposées',
        blocks: [
          'La sonie court terme des deux versions alignées, sur le même graphe. Là où les courbes s’écartent, une version est plus forte que l’autre à cet endroit.',
        ],
      },
      {
        id: 'carte-differences',
        title: 'Carte des différences',
        keywords: 'heatmap carte seconde par seconde écart',
        blocks: [
          'Seconde par seconde (de gauche à droite), l’écart entre les deux versions pour la sonie et pour chaque bande (une ligne chacune). Une couleur pour « plus fort », une autre pour « plus faible », d’autant plus marquée que l’écart est grand (pleine à ±6 dB et plus, échelle sous la carte) ; cellule vide où l’une des deux est silencieuse. Survol = valeur exacte, clic = écouter.',
        ],
      },
      {
        id: 'contrastes',
        title: 'Contrastes entre sections',
        keywords: 'section drop montée écart barres',
        blocks: [
          'Pour chaque section, l’écart avec le **morceau entier** : la sonie (LU) et l’énergie de chaque bande (dB), en tableau (une ligne par section). Valeur positive = plus que la moyenne du morceau. Les grands écarts sont en gras, les petits en gris (voir [[lecture|Lire les écarts]]). « Voir les contrastes en barres » montre les mêmes chiffres en barres (vers la droite = plus). Voir le flux [[flux-sections|Sections et contrastes]].',
        ],
      },
      {
        id: 'ecoute-ab',
        title: 'Écoute A/B à volume égal',
        keywords: 'a/b ab écouter comparer volume égal référence',
        blocks: [
          'Deux lecteurs gardés à la même position : A = ton master, B = la référence choisie. « Lire » les démarre ensemble ; les boutons A et B changent ce que tu entends sans revenir en arrière.',
          'Pour comparer **à la même sonie**, la plus forte des deux est **baissée** à la lecture (le volume n’est jamais monté, aucun fichier n’est modifié). La ligne sous les boutons dit laquelle est baissée et de combien.',
        ],
      },
      {
        id: 'equilibre-references',
        title: 'Comparaison à sonie égale',
        keywords: 'références équilibre bandes tiers octave sections moyenne',
        blocks: [
          'Avant de comparer l’équilibre, les références sont ramenées à la sonie de ton master (seulement pour le calcul). Ainsi « Sub : −3,1 dB » veut dire : à volume égal, ton master a 3,1 dB de sub de moins que la moyenne des références.',
          {
            list: [
              '**Équilibre par bande** : master moins moyenne des références, par bande.',
              '**Spectre au tiers d’octave** : les deux courbes, à sonie égale.',
              '**Par section** : chaque section du master comparée à la section de même nom de la référence quand elle existe (sinon à la référence entière).',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'flux',
    title: 'Flux de travail',
    sections: [
      {
        id: 'flux-boucle',
        title: 'La boucle de production',
        keywords: 'workflow itération export daw version',
        blocks: [
          {
            steps: [
              'Exporte ton master depuis ton logiciel de musique.',
              'Ajoute-le au projet du morceau (glisser-déposer, ou automatiquement avec le [[flux-dossier|dossier surveillé]]).',
              'Regarde les repères et les [[vue-mesures-globales|Mesures globales]].',
              'Ouvre [[vue-versions|Versions]] : la version précédente est choisie par défaut ; vérifie ce qui a bougé, section par section.',
              'Retouche dans ton logiciel, exporte, recommence.',
            ],
          },
          'Nomme les versions (« v3 compresseur bus ») pour t’y retrouver ; l’export HTML garde une trace d’une étape.',
        ],
      },
      {
        id: 'flux-sections',
        title: 'Sections et contrastes : un drop qui décolle',
        keywords: 'drop montée impact contraste énergie',
        blocks: [
          'Exemple : vérifier que le drop **décolle** après la montée.',
          {
            steps: [
              'Dans [[vue-sections|Sections]], vérifie le découpage : renomme ou déplace les limites pour avoir une « Montée » et un « Drop » justes.',
              'Compare la colonne **Sonie** des deux : l’écart en LU est le saut de volume perçu.',
              'Dans **Contrastes**, lis la ligne du Drop : sub et graves au-dessus de la moyenne du morceau, ou pas.',
              'Ajoute les colonnes **Largeur** et **Densité** (bouton « Colonnes ») : une montée étroite qui s’ouvre au drop, une partie plus chargée.',
              'Après une retouche, [[vue-versions|Versions]] › « Par section » montre l’écart du Drop d’une version à l’autre.',
            ],
          },
        ],
      },
      {
        id: 'flux-references',
        title: 'Références et A/B',
        keywords: 'profil référence comparer genre',
        blocks: [
          {
            steps: [
              'Dans [[vue-references|Références]], « Nouveau profil » (un par style), puis « Ajouter des références… » (des morceaux dont le rendu te sert de repère).',
              'Lis l’**équilibre par bande** à sonie égale : il ne dépend pas du volume des références.',
              'Nomme les sections des références comme les tiennes (Drop, Intro…) pour comparer partie par partie.',
              'Écoute en [[ecoute-ab|A/B]] : bascule pendant la lecture, au même endroit, à la même sonie.',
            ],
          },
        ],
      },
      {
        id: 'flux-dossier',
        title: 'Dossier surveillé',
        keywords: 'automatique export dossier surveiller notification',
        blocks: [
          'Désactivé par défaut. Dans les [[reglages|réglages]], active « Surveiller un dossier » et choisis le dossier d’export de ton logiciel de musique.',
          {
            list: [
              'Chaque minute, un fichier audio nouveau ou réécrit est **copié** et analysé, une fois sa taille stable entre deux passages (export terminé).',
              'Il devient une nouvelle version du projet de même nom (« Obsidian v3.wav » → projet « Obsidian ») ; un morceau de la Bibliothèque est proposé d’après le nom.',
              'Une notification donne le résumé et la comparaison avec la version précédente (désactivable).',
              'Un fichier identique à une version existante est ignoré.',
              '**Lecture seule** : rien n’est jamais modifié, déplacé ni supprimé dans le dossier.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'reglages-chapitre',
    title: 'Réglages',
    sections: [
      {
        id: 'reglages',
        title: 'Réglages du module et leur effet',
        keywords: 'options paramètres seuil plateformes vérification dossier aide',
        blocks: [
          'Dans Réglages › Analyse du master :',
          {
            terms: [
              [
                'Seuil des dépassements de crête vraie',
                '−1 dBTP par défaut. Change les repères de crête vraie et la liste des dépassements (rien n’est réanalysé). Le champ à côté du lecteur change le seuil pour la page seulement.',
              ],
              [
                'Normalisation des plateformes',
                '« Nom:cible LUFS:mode:plafond dBTP » séparés par « ; » ; mode « both » = baissé et monté, « down » = seulement baissé. Change le tableau des plateformes.',
              ],
              [
                'Vérification rapide avant de générer une vidéo',
                'Oui par défaut. Avant une vidéo YouTube, un Pack Insta ou des Reels perso, signale sans bloquer une crête vraie au-dessus de 0 dBTP, un écrêtage, un long silence ou un problème de mono. En Reels perso « Son de la vidéo », le master n’est pas vérifié (il n’est pas entendu) et c’est dit.',
              ],
              [
                'Export des données : virgule décimale (Excel en français)',
                'Non par défaut. Dans courbes.csv (« Données complètes »), écrit « 1,5 » au lieu de « 1.5 » pour qu’Excel en français lise des nombres ; le séparateur reste « ; ».',
              ],
              ['Surveiller un dossier', 'Non par défaut. Voir [[flux-dossier|Dossier surveillé]].'],
              ['Dossier surveillé', 'Le chemin du dossier.'],
              ['Notification à la fin d’une analyse du dossier surveillé', 'Oui par défaut.'],
              [
                'Afficher les « ? » d’aide',
                'Oui par défaut. Les « ? » à côté des graphes et des mesures ouvrent ce guide ; le bouton « Guide » reste toujours là.',
              ],
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'limites-chapitre',
    title: 'Limites et pièges',
    sections: [
      {
        id: 'limites',
        title: 'Limites et pièges',
        keywords: 'précision erreur piège attention mp3',
        blocks: [
          {
            list: [
              '**Informatif seulement** : aucun chiffre n’est « bon » ou « mauvais » en soi ; les cibles dépendent du style et de la plateforme.',
              '**MP3 et autres formats avec perte** : la crête vraie et les aigus mesurés sont ceux du fichier compressé, pas du master d’origine. Analyse de préférence le WAV ou le FLAC.',
              '**Sonie d’un morceau court ou très calme** : les portes de BS.1770 peuvent ignorer une grande partie du fichier ; la sonie intégrée peut alors manquer (« — »).',
              '**Sections automatiques** : un point de départ ; un break ou une montée lente peuvent être mal placés. Vérifie-les avant de comparer section par section.',
              '**Alignement** : sur deux versions très différentes (nouvelle structure), la confiance baisse ; règle le décalage à la main.',
              '**Valeurs des plateformes** : YouTube, Apple Music et Deezer ne publient pas officiellement leurs cibles ; elles peuvent changer.',
              '**Le volume d’écoute A/B** est baissé, jamais monté : si ta référence est beaucoup plus forte, tout le passage B sera plus bas que ton écoute habituelle.',
              '**Quelques écarts de mesure** avec d’autres outils sont normaux (±0,1 LU pour la sonie, choix de fenêtres différents pour la largeur ou la corrélation).',
            ],
          },
        ],
      },
    ],
  },
];

const ALL = GUIDE.flatMap((chapter) => chapter.sections.map((section) => ({ chapter, section })));

export function sectionById(id: string): GuideSection | null {
  return ALL.find((x) => x.section.id === id)?.section ?? null;
}

/** Lower case, without accents: what the search compares. */
export const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Plain text of a block, links and bold marks removed. */
export function plainText(block: Block): string {
  const clean = (s: string) => s.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/\*\*/g, '');
  if (typeof block === 'string') return clean(block);
  if ('list' in block) return block.list.map(clean).join(' ');
  if ('steps' in block) return block.steps.map(clean).join(' ');
  if ('terms' in block) return block.terms.map(([t, d]) => `${t} ${clean(d)}`).join(' ');
  if ('note' in block) return clean(block.note);
  return `${block.caption} ${block.marks.map((m) => m.label).join(' ')}`;
}

/** Sections matching every word of `query` (accents and case ignored). */
export function searchGuide(query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ALL.filter(({ section }) => {
    const text = fold(
      [section.title, section.keywords ?? '', ...section.blocks.map(plainText)].join(' '),
    );
    return words.every((w) => text.includes(w));
  });
}

/** Every [[id|…]] link of the guide (checked by the tests). */
export function linkTargets(): string[] {
  const text = JSON.stringify(GUIDE);
  return [...text.matchAll(/\[\[([a-z0-9-]+)\|/g)].map((m) => m[1]!);
}
