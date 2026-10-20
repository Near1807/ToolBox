# 0018 — Comptes connectés : OAuth « application installée », dans le socle

- Statut : acceptée
- Date : 2026-10-20

## Contexte

Le Planning de sortie envoie et programme des vidéos sur YouTube ; le futur `youtube-stats` lira les statistiques de la même chaîne. Il faut un compte Google connecté une fois, réutilisable par plusieurs modules, sans identifiant dans le dépôt et sans serveur intermédiaire.

## Décision

- **`ctx.accounts` dans le socle**, générique : le socle connaît des _fournisseurs OAuth_ (aujourd'hui `google` : pages d'autorisation, de jeton, de révocation, base de l'API), jamais l'usage qu'un module en fait. Un module déclare `permissions.accounts: ["google"]` et demande ses propres autorisations (scopes), cumulées avec celles déjà accordées (`include_granted_scopes`).
- **Flux pour applications installées** recommandé par Google :
  - le **navigateur système** s'ouvre sur la page de consentement ;
  - la redirection arrive sur un **serveur d'écoute éphémère `http://127.0.0.1:<port libre>`** ;
  - **PKCE S256** et `state` aléatoire, `access_type=offline` pour le jeton de longue durée, 5 minutes pour répondre.
- **Le client OAuth est celui de l'utilisateur** (son projet Google Cloud, type « Application de bureau ») : ID et code secret saisis dans Réglages › Comptes connectés, le secret chiffré. Rien n'est livré avec l'app : pas de secret dans le dépôt, pas de quota partagé, et chacun contrôle son projet. Google ne traite pas comme secret le code d'un client de bureau, mais l'exige à l'échange du code.
- **Jetons chiffrés** par `safeStorage` (via `HostAdapter`), table `core__accounts` (migration 3 du socle), jamais envoyés à l'interface. Le rafraîchissement est automatique. Un `invalid_grant` passe le compte « À reconnecter » ; les modules reçoivent une `AccountError` au message français (409 dans les routes).
- **`ctx.accounts.fetch`** : requête authentifiée, renvoyée une fois après rafraîchissement sur 401. Les modules n'écrivent jamais la gestion des jetons.
- Les points d'accès des fournisseurs sont surchargeables (`HubOptions.accountProviders`) : les tests utilisent un faux Google (PKCE vérifié, jetons expirés, révoqués).

## Alternatives écartées

- **Bibliothèque `googleapis` / `google-auth-library`** : lourde, et une dépendance de plus pour quelques requêtes HTTP.
- **Client OAuth intégré à l'app** : il faudrait publier un secret et faire valider l'app par Google pour tous ; chaque utilisateur partagerait le même quota.
- **Jetons dans les réglages du module** : chaque module réécrirait OAuth, et les jetons ne seraient pas partageables avec `youtube-stats`.
- **Flux « appareil » (code à saisir)** : non disponible pour les autorisations YouTube.

## Conséquences

- Mise en place unique par l'utilisateur dans la console Google (aide pas à pas dans le module). Il faut passer l'écran de consentement en **Production** : en mode « Test », les autorisations expirent au bout de 7 jours. En Production non validée, Google affiche un avertissement à la connexion, acceptable pour un usage personnel.
- Google exige une page d'accueil et une politique de confidentialité publiques pour la Production : elles sont dans `site/`, publiées par GitHub Pages depuis `hub-v1` (<https://near1807.github.io/ToolBox/>). L'app n'est pas soumise à validation.
- Autorisation expirée ou retirée : les envois restent en attente, l'interface propose « Reconnecter » et une notification prévient (une fois par expiration).
- `youtube-stats` (phase 5) réutilise le compte : il ajoutera `youtube.readonly` ou `yt-analytics.readonly` à la connexion.
