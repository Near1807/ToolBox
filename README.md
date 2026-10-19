# ToolBox

Hub d'outils personnel : une application de bureau Windows qui regroupe des modules (outils). Première section : **Musique** (génération de vidéos YouTube et Instagram à partir d'un morceau et de sa cover, statistiques YouTube).

## Démarrer

```bash
npm ci
npm run dev        # app de bureau + interface aussi ouvrable sur http://localhost:5173
npm test
npm run dist:win   # sous Windows : installateur et version portable dans dist/
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — résumé, commandes, conventions (point d'entrée)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — vue d'ensemble
- [`docs/MODULES.md`](docs/MODULES.md) — contrat de module
- [`modules/_template/`](modules/_template/) — module modèle à copier
- [`docs/AJOUTER-UN-MODULE.md`](docs/AJOUTER-UN-MODULE.md) — guide pratique
- [`docs/WINDOWS.md`](docs/WINDOWS.md) — installation, avertissement SmartScreen, données
- [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`CHANGELOG.md`](CHANGELOG.md) · [`docs/decisions/`](docs/decisions/)
