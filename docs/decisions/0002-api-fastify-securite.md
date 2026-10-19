# 0002 — API REST Fastify sécurisée, interface même origine

- Statut : acceptée
- Date : 2026-10-19

## Contexte

Le frontend ne parle au backend que par HTTP, ce qui permet de le développer dans un navigateur. Or une API sur `localhost` est joignable par tout process local et toute page web ouverte dans le navigateur (CSRF, DNS rebinding).

## Décision

- **Fastify** plutôt qu'Express : TypeScript natif, plugins avec préfixe de routes isolé (un préfixe par module), validation par schéma, `inject()` pour les tests sans réseau.
- **Même origine** : en production, le backend sert lui-même l'interface ; en dev, le proxy Vite relaie `/api`. Aucun en-tête CORS n'est émis.
- **Sécurité** (`backend/core/security.ts`) : vérification de `Host`, refus des `Origin` étrangères et des requêtes `Sec-Fetch-Site: cross-site`, jeton de session aléatoire par lancement sur toutes les routes `/api/*` (sauf `/api/health`).
- **SSE** : `EventSource` ne peut pas envoyer d'en-tête. Les routes de flux déclarent `config: { streamTicket: true }` et acceptent un ticket `?ticket=` à usage unique, valable 30 s, obtenu par `POST /api/core/stream-tickets`. Alternative écartée : `fetch` en streaming (perd la reconnexion native et complique le client sans gain de sécurité).
- **Port** aléatoire en production, fixe (47321) en dev pour le proxy Vite.

## Conséquences

- Le jeton n'apparaît jamais dans une URL, sauf sous forme de ticket jetable.
- Le client SSE doit redemander un ticket pour se reconnecter.
