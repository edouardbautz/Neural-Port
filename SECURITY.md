# Politique de sécurité

## Versions prises en charge

Seule la dernière version publiée reçoit des correctifs de sécurité.

| Version        | Prise en charge |
| -------------- | --------------- |
| dernière (`main`) | oui          |
| précédentes    | non             |

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique pour une faille de sécurité.**

Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**. Décrivez le problème, les étapes pour le reproduire et son impact potentiel.

Vous pouvez vous attendre à un accusé de réception sous quelques jours, puis à un suivi régulier jusqu'à la correction. Une fois le correctif publié, nous créditons volontiers la personne à l'origine du signalement, si elle le souhaite.

## Ce qui est concerné

Neural-Port est une interface web qui s'exécute dans votre navigateur et dialogue avec **votre** serveur Ollama. Il n'y a ni compte, ni serveur distant, ni télémétrie. Les sujets les plus pertinents sont par exemple :

- l'exécution de script via le rendu Markdown des réponses (XSS) ;
- la fuite de données de conversation vers un tiers ;
- la corruption ou l'exposition du contenu du stockage local via un fichier d'import malveillant.

## Bonnes pratiques côté utilisateur

- N'exposez pas Ollama sur Internet : il n'a pas d'authentification. Si vous l'ouvrez à votre réseau local (`OLLAMA_HOST`), limitez les origines autorisées (`OLLAMA_ORIGINS`) au strict nécessaire plutôt que `*`.
- Vos conversations sont stockées dans le navigateur, en clair : sur une machine partagée, utilisez un profil dédié.
