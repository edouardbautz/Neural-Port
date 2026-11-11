# Changelog

Toutes les évolutions notables du projet sont consignées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet adopte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Modifié
- Mise à jour des dépendances : React 19.3, Tailwind CSS 4.3, ESLint 10, Vite 8 et `@vitejs/plugin-react` 6 (Node 20.19+ ou 22.12+ requis).
- Actions GitHub `checkout` et `setup-node` en version 7.

## [0.1.0] - 2026-11-11

Première version publique.

### Ajouté
- Interface de chat pour Ollama : streaming, arrêt de la génération, statut détaillé (chargement du modèle, traitement du contexte, réflexion).
- Historique des conversations : barre latérale, nommage automatique, renommage, recherche, suppression.
- Rendu Markdown avec coloration syntaxique (thèmes clair et sombre) et copie du code.
- Fichiers générés : outil `create_file`, repli depuis les blocs de code, panneau d'aperçu et téléchargement.
- Réglages de la fenêtre de contexte et du niveau de réflexion, avec jauge d'utilisation.
- Compaction automatique des longues conversations par résumé roulant, déclenchable à la main.
- Édition d'un message et régénération d'une réponse.
- Export et import JSON des conversations.
- Connexion à Ollama : bannière explicative, reconnexion automatique, écran « aucun modèle », adresse du serveur réglable.
- Avertissement quand le stockage du navigateur est plein.
- Raccourcis clavier : `Ctrl+K`, `Ctrl+,`, `Échap`.

### Corrigé
- Les noms de technologies comme « Node.js » ou « Vue.js » ne sont plus pris pour des demandes de fichier.
- Un historique partiellement corrompu est réparé au lieu d'être jeté en entier.
- Échap et `Ctrl+K` fonctionnent pendant la vérification du modèle ; la dernière ligne du flux Ollama est toujours lue.
- Les blocs de code n'affichent plus un rectangle par ligne de texte, et le code en ligne n'est plus entouré de backticks parasites.

[Non publié]: https://github.com/edouardbautz/Neural-Port/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/edouardbautz/Neural-Port/releases/tag/v0.1.0
