# Ingénierie des prompts de Neural-Port

Ce document explique **ce que Neural-Port dit au modèle, pourquoi, et comment on l'a mesuré**. Chaque choix ci-dessous
est appuyé par une expérience reproductible (`npm run eval:prompts`), pas par une intuition.

## En bref

| | Avant | Après |
|---|---|---|
| 46 cas de conception, température 0,2 | 65 % [57–73] | **88 % [82–93]** |
| 15 cas mis de côté (jamais vus pendant la conception), température 0,2 | 67 % [52–79] | **93 % [82–98]** |
| 46 cas, température 0,4 — **le réglage par défaut de l'application** | 58 % [50–66] *(avant : température 1,0 du modèle)* | **86 % [79–91]** |
| 46 cas, température 1,0 (défaut du modèle) | 58 % [50–66] | 67 % [58–74] |
| Résumés de compaction réussis (langue, faits, pas d'invention) | 52 % [33–70] | **64 % [45–80]** |
| Prompt système | aucun (sauf une phrase sur l'outil) | 4 lignes, ~86 tokens |

Intervalles de confiance à 95 % (méthode de Wilson). Modèle évalué : `qwen3.5:0.8b` (0,8 milliard de paramètres) — voir
[Limites](#limites-et-honnêteté-sur-la-méthode).

**À retenir** : le prompt apporte un gain net et significatif à température basse, mais **la température compte autant que
le prompt** (section 8) : au réglage par défaut du modèle, qui est très aléatoire (1,0), le gain est réduit et non significatif ; c'est pourquoi l'application propose un réglage de température, à 0,4 par défaut.

## Ce qui est envoyé au modèle

Trois textes, tous définis dans `src/lib/` :

1. **Le prompt système** (`prompts.ts`, `buildSystemPrompt`) :

   ```
   You are a local AI assistant (model qwen3.5:0.8b, running through Ollama) with no Internet access. Today is Wednesday, November 11, 2026 (Europe/Paris).
   Reply in the user's language. Be concise and direct. If you don't know, say so: never make things up.
   Put code in ``` blocks tagged with the language name.
   Use the create_file tool only when the user asks for a file.          ← seulement quand l'outil est proposé
   ```

2. **La définition de l'outil `create_file`** (`prompts.ts`) : le JSON de l'outil est lu par le modèle, c'est donc du prompt.
3. **Le prompt de compaction** (`compaction.ts`, `buildSummarizerMessages`) : il résume les anciens messages quand la
   fenêtre de contexte se remplit. Ses consignes sont écrites **dans la langue de la conversation**.

## Méthode

### Un banc d'évaluation, pas un essai à l'œil

`src/eval/` contient un banc complet, sans dépendance externe, lancé par `npm run eval:prompts` :

- **68 cas** (46 de conception, 15 mis de côté, 7 pour les instructions personnalisées) répartis en 9 catégories : langue, concision (forme demandée), code (blocs refermés, avec langage),
  tableaux, contexte d'exécution (date, modèle, accès Internet), honnêteté (ne pas inventer), usage de l'outil
  (l'appeler à bon escient), outil à éviter (le mot « fichier » ne justifie pas de créer un fichier) et personnalisation.
- **Des correcteurs déterministes** (`graders.ts`), volontairement sans « modèle juge » : un petit modèle local est un
  mauvais juge, alors qu'un correcteur en code est reproductible, gratuit et testable.
- **L'évaluation est elle-même testée** : chaque cas embarque une bonne et une mauvaise réponse d'exemple, et un test
  vérifie que le correcteur accepte la première et refuse la seconde (`cases.test.ts`, `summary.test.ts`). Un correcteur
  qui ne distingue pas le bon du mauvais ne mesure rien.
- **Statistiques honnêtes** (`stats.ts`) : intervalles de Wilson, et une différence n'est déclarée significative (▲) que si
  les intervalles de deux variantes sont disjoints.
- **Reproductibilité** : température 0,2, graines fixes, date de référence fixe (les réponses attendues ne dépendent pas du
  jour de l'essai), résultats enregistrés essai par essai (JSONL), et possibilité de **re-noter** des essais déjà
  enregistrés avec de nouveaux correcteurs sans réinterroger le modèle (`--regrade`).
- **Cas mis de côté** : 15 cas écrits *après* le choix du prompt (`HELD_OUT_CASES`), avec d'autres graines, pour mesurer la
  généralisation : un prompt choisi sur un jeu de cas obtient forcément un score optimiste sur ce jeu.

Au total, environ **2 800 appels** au modèle ont été réalisés pour arriver au prompt actuel.

### Démarche : on ajoute, on mesure, on retire

Quatre rondes de comparaison, chacune partant du meilleur candidat de la précédente :

| Ronde | Question | Variantes | Essais |
|---|---|---|---|
| 1 | Quelle langue, quelle longueur ? | référence, français court/complet, anglais court/complet | 360 |
| 2 | Quelle règle apporte quelque chose ? | `en-court` + honnêteté / forme / code + « pas de formule d'intro » | 630 |
| 3 | Des exemples (few-shot) ? La date en français ? Plus court encore ? | 4 variantes | 690 |
| 4 | La description de l'outil compte-t-elle ? | français, anglais, anglais minimal | 414 |

## Ce que les mesures ont montré

### 1. La langue du prompt dicte la langue de la réponse

Un prompt système **en français** fait répondre en français à des questions **en anglais**, malgré la consigne « réponds
dans la langue de l'utilisateur » :

| Variante (ronde 1) | Langue respectée | Usage de l'outil | Réussite globale |
|---|---|---|---|
| `fr-complet` | **50 %** | **0 %** | 57 % |
| `fr-court` | 75 % | 70 % | 75 % |
| `en-court` | **100 %** | **90 %** | **89 %** |
| `en-complet` | 100 % | 40 % | 83 % |
| référence (aucun prompt) | 100 % | 80 % | 61 % |

Le même effet existe dans la compaction : consignes françaises sur une conversation anglaise → résumé en français, avec
les dates traduites (« April 30 » devient « 30 avril »). D'où l'écriture du prompt système en anglais, et le choix des
consignes de compaction **selon la langue détectée de la conversation** (langue du résumé correcte : 80 % → **100 %**).

### 2. Moins de règles, meilleur résultat

Avec un petit modèle, chaque règle ajoutée entre en concurrence avec les autres :

- Un paragraphe détaillé sur l'outil a fait tomber son usage de 90 % à **0 %** (`fr-complet`) ou 40 % (`en-complet`).
- Ronde 2 : le respect des blocs de code passe de **100 %** (`en-court-jour`) à **60 %** quand on ajoute des règles.
- Aucune règle supplémentaire n'a amélioré l'honnêteté de façon significative (46–58 % contre 58 %).

### 3. Une consigne négative amorce ce qu'elle interdit

« Pas de formule d'introduction (« Sure! ») » a fait **apparaître** des formules d'introduction dans 10 % des réponses
(`en-regles`), contre 0 % sans cette consigne : citer l'exemple à éviter l'amorce.

### 4. Les exemples (few-shot) : un gain isolé, un bilan négatif

Deux exemples dans le prompt améliorent l'honnêteté (58 % → 75 %) mais font **dériver la langue** (un exemple de réponse
brève en français fait répondre « Rouge et Bleu. » à une question en anglais), et dégradent la concision, le code et
l'outil. Bilan net : 84 % contre 88 %. Ils n'ont pas été retenus.

### 5. La date, oui ; l'heure, non — à cause du cache de préfixe

Ollama réutilise le calcul du début de la requête quand il est identique d'un message à l'autre. Mesuré sur une
conversation de ~5 000 tokens :

| Requête | Temps de traitement du prompt |
|---|---|
| Première requête | 2 484 ms |
| Même début, nouvelle question | **630 ms** (4× plus rapide) |
| Heure changée d'**une minute** dans le prompt système | 2 476 ms (tout est retraité) |
| Prompt sans heure, question suivante | **621 ms** |

Mettre l'heure exacte dans le prompt système rendrait donc chaque message ~4× plus lent sur une longue conversation. Le
prompt ne contient que **la date** : il est identique toute la journée (un test unitaire le garantit).

À l'inverse, `prompt_eval_count` reste correct (~5 000) même quand le cache est utilisé : la calibration des tokens de la
compaction n'est pas faussée.

### 6. Les extraits fidèles de la compaction valent mieux que le résumé du modèle

La compaction ajoute au résumé des **extraits mot pour mot** des messages de l'utilisateur. Mesuré sur 5 conversations :

| | Rappel des faits (noms, dates, nombres, fichiers) |
|---|---|
| Résumé du modèle seul | ~85 % |
| Résumé + extraits fidèles (ce que le modèle voit réellement) | **100 %** |

Un résumé généré par un petit modèle perd des faits ; les recopier ne les déforme pas. Les rares nombres **inventés** par le
modèle (par exemple « 3 nuits × 85 € = 265 € », un calcul faux) sont détectés par le banc.

Autre contamination de langue découverte : les étiquettes « UTILISATEUR : / ASSISTANT : » insérées par l'application
faisaient écrire en français le résumé d'une conversation anglaise. Elles suivent maintenant la langue de la conversation.

### 7. Ce qui reste hors de portée du prompt

L'**honnêteté** (ne pas inventer un roman, une fonction numpy ou un article de loi inexistants) plafonne à 58–67 % :
c'est une limite de capacité d'un modèle de 0,8 milliard de paramètres, qu'aucune formulation testée n'a levée. Le prompt
améliore nettement le comportement (8 % → 58 %) mais ne le garantit pas.

### 8. La température compte autant que le prompt

L'application n'envoie pas de température : le modèle utilise la sienne. Pour `qwen3.5:0.8b`, ses paramètres par défaut
sont `temperature 1`, `top_p 0.95`, `top_k 20`, `presence_penalty 1.5`, des réglages pensés pour son mode réflexion.
Même prompt (`production`), mêmes 46 cas, seule la température change :

| Température | Réussite [IC 95 %] |
|---|---|
| 0,2 | **88 %** [82–93] |
| 0,4 | 86 % [79–91] |
| 0,7 | 75 % [68–82] |
| 1,0 (défaut du modèle, réglage actuel) | 67 % [58–74] |

Passer de 0,4 à 1,0 coûte **près de 20 points**, plus que ce que le prompt rapporte. L'application expose donc ce réglage
(**Paramètres → Température** : Précis 0,2 · Équilibré 0,4 · Souple 0,7 · Créatif 1,0) avec **Équilibré** par défaut :
presque aussi fiable que « Précis » (86 % contre 88 %), avec un peu de variété. Pour l'écriture ou le brainstorming, on peut
repasser en « Créatif ». La valeur est envoyée à Ollama à chaque message (`options.temperature`).

### 9. Les instructions personnalisées de l'utilisateur

Le champ **Paramètres → Instructions personnalisées** (800 caractères au plus, compteur en tokens, effaçable) ajoute le texte de
l'utilisateur à la fin du prompt système. Sept cas ont mesuré si un petit modèle les suit (5 essais, température 0,4) : prénom à
utiliser, ligne de signature exacte, exemples toujours en Python, réponse détaillée contre la règle « concis » du prompt de base,
etc. Où et comment insérer le texte ?

| Variante | Consignes suivies [IC 95 %] |
|---|---|
| Instructions ignorées (témoin) | 11 % [5–26] |
| **À la fin, sous « Additional instructions: »** (retenue) | **57 % [41–72]** ▲ |
| Au début du prompt | 57 % [41–72] |
| À la fin, intitulé « from the user » | 46 % [30–62] |
| À la fin, présentées comme prioritaires sur les règles | 46 % [30–62] |
| À la fin, avec la règle de langue assouplie | 43 % [28–59] |

La formulation la plus simple est retenue : les variantes plus élaborées ne font pas mieux, comme pour le prompt de base.
Cas par cas, avec la formulation retenue : prénom 5/5, signature exacte 5/5, détail demandé malgré « concis » 5/5, exemples
en Python 4/5 ; en revanche **« réponds toujours en anglais » à une question en français : 0/5**, « 20 mots au plus » : 0/5,
« tutoie-moi » : 1/5. Ces trois-là dépassent un modèle de 0,8 milliard de paramètres : la règle de langue du prompt de base
et son habitude de vouvoyer pèsent plus lourd que la consigne.

Choix de conception : le texte est normalisé (retours à la ligne, plafond), il compte dans l'estimation de la fenêtre de
contexte, et le prompt reste identique d'un message à l'autre tant que le texte ne change pas (cache de préfixe conservé).

### 10. Le modèle doit relire ce qu'il a écrit dans ses fichiers

Quand le modèle crée un fichier avec l'outil `create_file`, son contenu n'apparaît dans aucun message affiché : l'historique
rejoué au message suivant ne contenait **que le nom** du fichier (`[Fichiers créés : tva.py]`). Le modèle ne pouvait donc
ni répondre « que contient ce fichier ? » ni le modifier sans le réécrire de mémoire. Six conversations à plusieurs tours,
dont le contenu des fichiers n'est dans aucun message de l'utilisateur (taux d'un fichier `tva.py`, port d'un
`config.json`, ajout d'une fonction sans écraser les autres, information retrouvée après un échange sans rapport…) :

| Historique rejoué | Réussite [IC 95 %] |
|---|---|
| Noms seuls (comportement d'origine) | **11 %** [4–25] |
| Contenu ajouté au texte du message | 75 % [65–83] |
| **Appel d'outil rejoué au format natif d'Ollama** (`tool_calls` + message `tool`) — retenu | **92 %** [84–96] |

Le format natif est significativement meilleur que le texte (compter les éléments d'un fichier : 8/8 contre 4/8 ; retrouver une
information plus loin dans la conversation : 8/8 contre 5/8), y compris quand la question ne déclenche pas l'outil et que la
requête est envoyée **sans liste d'outils** (94 % contre 56 %). Une consigne supplémentaire (« pour modifier un fichier, le
réécrire en entier ») n'a rien changé (81 % des deux côtés).

Choix de conception : le format natif n'est utilisé que si le modèle gère les outils ; sinon, et pour les fichiers déjà visibles
dans le texte du message (blocs de code transformés en fichiers), le contenu est ajouté en texte. Un fichier de plus de
8 000 caractères est tronqué au milieu (début, fin et nombre de lignes omises) pour ne pas saturer la fenêtre de contexte, et
la taille de ces appels est comptée dans l'estimation qui déclenche la compaction.

## Résultats finaux (température 0,2)

Évaluation du **code réel de l'application** (`production`), contre le comportement d'origine :

| Catégorie | Conception (46 cas × 3) | | Mis de côté (15 cas × 3) | |
|---|---|---|---|---|
| | référence | production | référence | production |
| **Global** | 65 % | **88 %** ▲ | 67 % | **93 %** ▲ |
| langue | 100 % | 100 % | 100 % | 100 % |
| concision | 100 % | 100 % | 100 % | 100 % |
| code | 53 % | **100 %** | 50 % | **100 %** |
| tableau | 75 % | 75 % | 100 % | 100 % |
| contexte (date, modèle, Internet) | 33 % | **93 %** | 17 % | **100 %** |
| honnêteté | 8 % | **58 %** | 17 % | **67 %** |
| outil (créer un fichier) | 75 % | **92 %** | 67 % | 83 % |
| outil à éviter | 100 % | 100 % | 100 % | 100 % |

Le score sur les cas mis de côté (93 %) n'est pas inférieur à celui des cas de conception (88 %) : pas de surapprentissage
visible. Coût du prompt : **~86 tokens**, soit environ 0,5 % d'une fenêtre de 16 384 tokens.

## Limites et honnêteté sur la méthode

- **Un seul modèle, et il est petit.** Tout a été mesuré avec `qwen3.5:0.8b`. Les conclusions sur la langue du prompt et la
  concision de la consigne sont probablement générales ; la saturation (« moins de règles ») est typique des petits modèles
  et pourrait ne pas se reproduire avec un modèle de 8 milliards de paramètres ou plus. Pour vérifier :
  `npm run eval:prompts -- --model <modèle> --variants reference,production`.
- **Réflexion désactivée.** Les rondes ont été faites avec `think: false`. Avec la réflexion activée (réglage par défaut de
  l'application), ce modèle épuise souvent son budget en réfléchissant ; l'application coupe alors la réflexion et relance
  sans réflexion, c'est-à-dire exactement le chemin évalué ici. La variante avec réflexion n'a pas été évaluée à grande échelle.
- **Les chiffres principaux sont à température 0,2** ; au réglage par défaut du modèle (1,0), le gain du prompt est plus faible (section 8). L'application utilise désormais 0,4 par défaut (86 % mesuré).
- **Peu d'essais.** 3 par cas : les intervalles sont larges, et seules les différences d'au moins ~15 points sont
  significatives. Plusieurs écarts entre candidats (par exemple 87 % contre 88 %) ne sont **pas** significatifs, d'où le
  choix de la variante la plus simple et la moins chère.
- **Correcteurs heuristiques.** Détection de la langue par mots courants, formules d'aveu d'ignorance par liste. Quatre
  défauts ont été trouvés en lisant les échecs réels et corrigés, **à chaque fois appliqués à toutes les variantes** puis
  tous les essais re-notés : (1) une réponse très courte (« Today is Wednesday. ») n'était pas classée dans sa langue,
  (2) « Non, je ne suis pas connecté » n'était pas reconnu comme un aveu, (3) un critère de taille de résumé n'avait pas de
  sens sur des textes de test courts, (4) « une seule phrase » refusait une réponse d'un seul mot (sans effet sur les chiffres). Ces corrections a posteriori sont un biais potentiel, c'est pourquoi elles sont listées.
- **Cas écrits par les concepteurs.** Les cas mis de côté limitent le risque de surapprentissage, ils ne le suppriment pas.

## Reproduire

```bash
npm run eval:prompts -- --variants reference,production --samples 3          # cas de conception
npm run eval:prompts -- --held-out true --variants reference,production --samples 3 --seed 5000
npm run eval:prompts -- --suite summary --variants actuel,adaptatif --samples 5   # compaction
npm run eval:prompts -- --files true --variants hist-names,hist-text,hist-native --samples 8 # suivi des fichiers créés
npm run eval:prompts -- --regrade resultats.jsonl                              # re-noter sans réinterroger le modèle
```

Options utiles : `--model`, `--out fichier.jsonl`, `--cases code,outil` (préfixes d'identifiants), `--temperature 0.4`
(ou `default` : température du modèle, comme l'application), `--think true`. Les variantes comparées sont dans `src/eval/variants.ts` ; ajouter une idée de prompt, c'est ajouter une
entrée à ce fichier. Les tests de l'évaluation (`npm test`) vérifient les correcteurs, les cas et les statistiques.
