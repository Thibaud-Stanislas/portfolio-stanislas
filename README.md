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

GitHub Pages ne fait tourner que des fichiers statiques : pour garder le formulaire connecté à l’admin en ligne, il faut aussi héberger `server.js` et une base persistante (le fichier `railway.toml` prépare ce service), puis renseigner `apiBaseUrl` dans `config.js`, `CORS_ORIGIN` et `ADMIN_PASSWORD` dans les paramètres privés du serveur. Sur le site statique seul, le formulaire ouvre un e-mail prérempli et l’admin indique que le serveur doit être connecté.

Pour héberger tout le site et l’API sur un même service Node, définissez `ADMIN_PASSWORD`, utilisez `npm start` et montez un stockage persistant sur `/data` avec `DATA_DIR=/data`. Pour GitHub Pages + API, ajoutez `https://VOTRE_COMPTE.github.io` à `CORS_ORIGIN` et l’URL HTTPS du serveur dans `config.js`.

## Étude Tempo Studio

Tempo Studio est une étude de concept fictive pour un atelier de céramique. La démonstration permet de choisir une date et un créneau, puis enregistre la réservation sur l’API Node/SQLite quand le serveur répond. Sans serveur, elle reste interactive dans le navigateur et affiche clairement que les données sont locales et fictives.

## Vérifications

Lancer `npm test` pour exécuter les vérifications API : mot de passe et session, formulaire de contact, protection admin, changements d’état, filtres côté client, capacités et validation des réservations.

## Contact

stanislas.thibaud@gmail.com

