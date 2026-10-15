# Portfolio — Stanislas

Portfolio sombre et responsive pour présenter les services de développeur web freelance, trois études de concept fictives et une démonstration full-stack de réservation.

## Lancer le site complet en local

1. Installer Node.js 20 ou supérieur.
2. Dans ce dossier, lancer `npm install`.
3. Définir un mot de passe administrateur long dans la variable d’environnement `ADMIN_PASSWORD` (au moins 16 caractères) puis lancer `npm start`.
4. Ouvrir `http://localhost:4173`.

L’API, les messages, les réservations et l’admin fonctionnent sur le même serveur. Le mot de passe n’est jamais enregistré dans le dépôt. Le fichier `.env.example` montre les variables disponibles ; copiez-le dans `.env` si vous utilisez un chargeur de variables d’environnement, sans publier ce fichier.

## Administration

L’accès est dans le pied de page ou à `http://localhost:4173/admin/login.html`. L’admin reprend le fonctionnement du projet fourni : compteurs, filtres « Tous / Non traités / Traités », état lu/non lu, réponse par e-mail et suppression. Le mot de passe doit être fourni par `ADMIN_PASSWORD`. Les sessions expirent après 12 heures et le serveur limite les tentatives de connexion et d’envoi de messages.

## GitHub Pages

Le workflow `.github/workflows/static.yml` publie automatiquement le site statique après un push sur `master`. Il n’inclut pas le serveur, la base de données ni les fichiers de configuration sensibles dans le site publié.

GitHub Pages ne fait tourner que des fichiers statiques : pour connecter le formulaire de contact et l’admin en ligne, il faut aussi héberger `server.js` et une base persistante (le fichier `railway.toml` prépare ce service), puis renseigner `apiBaseUrl` dans `config.js`, `CORS_ORIGIN` et `ADMIN_PASSWORD` dans les paramètres privés du serveur. Sur le site statique seul, le contact propose un e-mail prérempli, l’admin indique que le serveur doit être connecté, et Tempo garde ses réservations fictives dans le navigateur.

Pour héberger tout le site et l’API sur un même service Node, définissez `ADMIN_PASSWORD`, utilisez `npm start` et montez un stockage persistant sur `/data` avec `DATA_DIR=/data`. Pour GitHub Pages + API, ajoutez `https://VOTRE_COMPTE.github.io` à `CORS_ORIGIN` et l’URL HTTPS du serveur dans `config.js`.

Pour le service API séparé sur Railway, utilisez `API_ONLY=true`, `TRUST_PROXY=1`, `NODE_ENV=production`, `DATA_DIR=/data` et un volume persistant monté sur `/data`. `API_ONLY` désactive la distribution des fichiers du projet par le serveur API. `TRUST_PROXY=1` permet de distinguer les visiteurs derrière le proxy Railway pour limiter les tentatives de connexion. Renseignez `ADMIN_PASSWORD` directement dans les variables privées de Railway ; sans cette valeur, la connexion est bloquée. Connectez `config.js` à l’URL du service seulement après un déploiement réussi et un contrôle de `/api/health`.

## Étude Tempo Studio

Tempo Studio est une étude de concept fictive pour un studio de yoga. La démonstration permet de choisir une pratique, une date et un créneau, puis enregistre la réservation sur l’API Node/SQLite quand le serveur répond. Sans serveur, elle reste interactive dans le navigateur et conserve les demandes localement.

## Vérifications

Lancer `npm test` pour exécuter les vérifications API de la connexion admin, de la validation et du traitement des messages, ainsi que des règles de réservation. La navigation mobile, le mode sombre, les filtres de projets, l’admin et les formulaires ont aussi été vérifiés dans le navigateur.

## Contact

stanislas.thibaud@gmail.com
