# Changelog

Toutes les évolutions notables du projet sont consignées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet adopte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Température
- Nouveau réglage **Paramètres → Température** (Précis 0,2 · Équilibré 0,4 · Souple 0,7 · Créatif 1,0), « Équilibré » par défaut. Mesuré sur le banc d'évaluation : 86 % de réussite à 0,4 contre 67 % à 1,0, le réglage par défaut du modèle utilisé jusqu'ici.
- Fermer les Paramètres rend le focus au champ de saisie.

### Prompts
- Prompt système (4 lignes, ~86 tokens) choisi par évaluation (température 0,2) : **65 % → 88 %** de réussite sur 46 cas, **67 % → 93 %** sur 15 cas mis de côté ; 58 % → 67 % à la température par défaut du modèle. Il fixe la langue de réponse, la concision, l'aveu d'ignorance et le format du code, et donne la date et le nom du modèle.
- La date (sans l'heure) garde le prompt identique toute la journée : le cache de préfixe d'Ollama est conservé (conversation longue retraitée 4× plus vite).
- Compaction : consignes et étiquettes de rôle dans la langue de la conversation (résumé dans la bonne langue : 80 % → 100 %).
- Banc d'évaluation reproductible (`npm run eval:prompts`) et rapport méthodologique : [docs/prompt-engineering.md](docs/prompt-engineering.md).

### Performance
- Streaming fluide même dans une longue conversation : le Markdown n'est plus ré-analysé en entier à chaque fragment (rendu mémoïsé, mises à jour de l'affichage regroupées). Mesuré sur 60 messages riches en Markdown : **84 ms → 1,4 ms de calcul par fragment**, et plus aucune tâche bloquante.
- Premier chargement allégé : le rendu Markdown et la coloration syntaxique sont chargés à part (script principal **616 → 298 kB**, 190 → 92 kB compressé).
- Historique dans IndexedDB : plus de plafond de 5 Mo, et seules les conversations modifiées sont écrites (au lieu de sérialiser tout l'historique). L'ancien historique est migré automatiquement ; repli sur `localStorage` si IndexedDB est indisponible.

### Accessibilité
- Contrastes de texte conformes WCAG AA en thème clair et sombre (vérifié avec axe-core : aucune violation sur téléphone, tablette et bureau).
- Repères de page (`main`, titre `h1`, navigation et panneaux nommés), pilotage au clavier du menu des modèles (flèches, Échap, retour du focus), Échap ferme les panneaux et la liste mobile, zones de code accessibles au clavier, annonces d'état pour les lecteurs d'écran.
- Cibles tactiles agrandies et nom accessible du sélecteur de modèle aligné sur son texte visible.

### Corrigé
- Les mots très longs sans espace (URL, chemins) ne débordent plus des bulles de message.
- Un appel d'outil mal formé dans le flux d'Ollama ne fait plus ignorer silencieusement tout le fragment.

### Modifié
- Le traitement du flux d'Ollama, le client de l'API, l'historique et la connexion sont extraits dans des modules et hooks testés (95 tests, dont les hooks sous jsdom).
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
