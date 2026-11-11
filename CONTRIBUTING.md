# Contribuer à Neural-Port

Merci de l'intérêt que vous portez à Neural-Port ! Les contributions sont les bienvenues : corrections de bugs, améliorations, documentation, traductions, idées.

En participant, vous acceptez de respecter le [code de conduite](CODE_OF_CONDUCT.md).

## Avant de commencer

- **Un bug ?** Cherchez d'abord dans les [issues](../../issues) s'il est déjà signalé, sinon ouvrez-en une avec le modèle « Bug ».
- **Une idée ?** Ouvrez une issue « Proposition » avant de coder une grosse fonctionnalité : cela évite de travailler pour rien si elle ne colle pas à la direction du projet.
- **Une faille de sécurité ?** Ne l'ouvrez pas en issue publique : voir [SECURITY.md](SECURITY.md).

## Mettre en place l'environnement

Prérequis : Node.js 20.19+ (ou 22.12+) et [Ollama](https://ollama.com) avec au moins un petit modèle (`ollama pull llama3.2:3b`).

```bash
git clone https://github.com/edouardbautz/Neural-Port.git
cd Neural-Port
npm install
npm run dev      # http://localhost:5173
```

## Avant d'ouvrir une pull request

Ces trois commandes doivent passer ; la CI les exécute à chaque push :

```bash
npm run lint
npm test
npm run build
```

Quelques repères :

- **Tests** : toute logique ajoutée dans `src/lib/` doit être couverte par un test Vitest (`*.test.ts` à côté du fichier). Un bug corrigé doit idéalement venir avec un test qui l'aurait détecté.
- **Interface** : testez dans un vrai navigateur, avec Ollama lancé, clair et sombre. Vérifiez aussi les états d'erreur (Ollama éteint, aucun modèle).
- **Langue** : l'interface et les commentaires sont en français ; les noms de variables et de fonctions en anglais.
- **Dépendances** : évitez d'en ajouter sans raison solide ; l'application doit rester légère.
- **Confidentialité** : Neural-Port fonctionne entièrement en local. Aucune requête ne doit partir vers un service tiers (télémétrie, polices distantes, analytics…).

## Messages de commit

Le projet suit la convention [Conventional Commits](https://www.conventionalcommits.org/fr/) :

```
feat: ajouter l'export des conversations
fix: ne pas dupliquer un message lors de la régénération
docs: documenter OLLAMA_ORIGINS
test: couvrir la réparation de l'historique
chore: mettre à jour les dépendances
```

Une phrase courte, à l'impératif, qui explique le *quoi* ; le *pourquoi* va dans le corps du message si ce n'est pas évident.

## Pull requests

1. Forkez le dépôt et créez une branche depuis `main` (`fix/nom-court`, `feat/nom-court`).
2. Gardez la PR **focalisée** : un sujet par PR.
3. Remplissez le modèle de PR (ce qui change, pourquoi, comment vous l'avez testé).
4. Soyez réactif aux retours ; une PR peut demander quelques allers-retours.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la [licence MIT](LICENSE) du projet.
