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

GitHub Pages ne fait tourner que des fichiers statiques. Le dossier `functions/` prépare l’API gratuite Cloudflare Pages et `migrations/0001_initial.sql` son schéma D1. Le script `npm run build:pages` copie uniquement les fichiers publics dans `dist/`, sans inclure le serveur Node ni la base locale.

### Mise en service Cloudflare gratuite

1. Créer un projet Cloudflare Pages relié à ce dépôt GitHub, branche `master`, commande de construction `npm run build:pages` et dossier de sortie `dist`.
2. Créer une base D1 au forfait gratuit, l’associer au projet Pages sous le nom de liaison `DB`, puis exécuter `migrations/0001_initial.sql` dans sa console.
3. Définir les secrets `SESSION_SECRET` et `ADMIN_SETUP_TOKEN` dans les variables privées Cloudflare (32 caractères aléatoires minimum), ainsi que `CORS_ORIGIN=https://thibaud-stanislas.github.io`.
4. Régler `apiBaseUrl` dans `config.js` vers l’adresse `pages.dev` du projet Cloudflare. Le même site servi par Cloudflare utilise son API sur la même origine.
5. Après publication, ouvrir `admin/create-account.html`, utiliser le code initial à usage unique, créer l’adresse et le mot de passe de l’unique compte, puis retirer `ADMIN_SETUP_TOKEN` des secrets Cloudflare.

L’inscription se ferme dès que le premier compte propriétaire existe. Les secrets restent dans les paramètres privés Cloudflare et ne sont jamais inscrits au dépôt.

Le forfait Cloudflare Free n’a pas d’abonnement mensuel. Il applique des quotas gratuits : si un quota est dépassé, les fonctions concernées peuvent répondre en erreur jusqu’à sa remise à zéro. Ne pas passer au forfait payant pour ce portfolio.

## Serveur local Node

Pour prévisualiser l’ancienne API Node en local, définissez `ADMIN_PASSWORD` puis lancez `npm start`. Le formulaire de connexion accepte toujours ce mode local. Le flux de création du compte et la persistance D1 sont disponibles dans la configuration Cloudflare Pages.

## Étude Tempo Studio

Tempo Studio est une étude de concept fictive pour un studio de yoga. La démonstration permet de choisir une pratique, une date et un créneau, puis enregistre la réservation sur l’API Node/SQLite quand le serveur répond. Sans serveur, elle reste interactive dans le navigateur et conserve les demandes localement.

## Vérifications

Lancer `npm test` pour exécuter les vérifications de l’API Node locale et de l’API Cloudflare/D1, notamment l’inscription unique, la connexion, les sessions, les messages, les réservations et le contrôle d’origine. `npm run build:pages` prépare les fichiers publics Cloudflare.

## Contact

stanislas.thibaud@gmail.com
