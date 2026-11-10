# Neural-Port

Neural-Port est une interface de chat conçue pour discuter avec vos modèles Ollama. Tout fonctionne en local, rien ne quitte votre machine.

L'idée est simple : profiter d'une interface soignée sans sacrifier la confidentialité.

## Fonctionnalités

**Historique des conversations**

Comme ChatGPT ou Claude, toutes vos conversations sont conservées dans une barre latérale. Chaque conversation est nommée automatiquement d'après votre premier message et mémorisée dans le navigateur : fermez la page, rouvrez-la, tout est là. Créez-en de nouvelles en un clic, revenez sur une ancienne, supprimez celles qui ne servent plus.

**Statut de génération en temps réel**

Quand vous patientez après avoir envoyé un message, l'interface vous indique précisément ce qui se passe. Si le modèle n'était pas en mémoire, vous voyez qu'il charge, puis qu'il traite votre contexte une fois prêt. Pour les modèles de raisonnement comme DeepSeek-R1 ou QwQ, une étape "Réflexion en cours" s'affiche pendant la phase de pensée, détectée directement dans le flux de l'API Ollama.

**Sélection de modèles automatique**

Tous vos modèles installés dans Ollama apparaissent dans le menu de sélection. Ajoutez-en un nouveau pendant que l'application tourne, il sera disponible au prochain clic.

**Rendu Markdown soigné**

Les réponses sont affichées en Markdown : tableaux stylés, citations, listes, liens, code inline et blocs de code avec en-tête (langue détectée), bouton de copie et coloration syntaxique qui s'adapte au thème clair ou sombre. Un bouton de copie est également disponible sur chaque bulle de réponse.

**Streaming et mode sombre**

Le texte s'affiche au fil de la génération. Un bouton en haut à droite bascule entre le thème clair et le thème sombre.

**Fichiers générés**

Demandez un fichier (« écris-moi `jeu.py` ») : le modèle le crée via l'outil `create_file` (ou, à défaut, le code est converti en fichier). Les fichiers apparaissent dans un panneau latéral, avec aperçu et téléchargement. Un bloc de code peut aussi être transformé en fichier d'un clic.

**Réflexion et fenêtre de contexte**

Le niveau de réflexion (Off / Low / Medium / High) et la taille de la fenêtre de contexte se règlent dans le panneau Paramètres (`Ctrl+,`), avec une jauge d'utilisation du contexte.

**Compaction automatique**

Quand la conversation approche de la limite de la fenêtre de contexte, les anciens messages sont résumés par le modèle et le résumé les remplace dans la requête. Vos messages restent affichés et conservés. Le seuil est réglable, et la compaction peut être lancée à la main.

**Édition et raccourcis**

Modifier un message, régénérer une réponse, renommer une conversation (double-clic), rechercher dans l'historique. `Ctrl+K` : nouvelle conversation · `Échap` : arrêter la génération.

## Prérequis

- Node.js v20.19+ (requis par Vite 7)
- [Ollama](https://ollama.com) installé et lancé

## Installation

```bash
git clone https://github.com/meteorelevrai/Neural-Port.git
cd Neural-Port
npm install
npm run dev
```

Accessible sur `http://localhost:5173`.

## Développement

```bash
npm run lint    # ESLint
npm test        # tests unitaires (Vitest)
npm run build   # vérification TypeScript + build de production
```

## Ajouter des modèles

Neural-Port détecte automatiquement les modèles disponibles. Pour en installer depuis Ollama :

```bash
ollama pull llama3.2:3b
ollama pull mistral:7b
ollama pull deepseek-r1:8b   # pour tester le raisonnement
```

## Licence

**Copyright © 2026 MeteoreLeVrai. Tous droits réservés.**

Usage personnel et privé autorisé. Toute redistribution ou usage commercial est interdit sans accord écrit de l'auteur.
