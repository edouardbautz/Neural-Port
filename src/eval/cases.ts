import { words } from "../lib/language"
import { countBullets, countSentences, dateForms, fenceReport, hasValidTable, hedges, includesAll, includesAny, languageMatches } from "./graders"
import type { EvalCase, EvalEnv, Reply } from "./types"

// Date fixe des essais : les réponses attendues (date, jour) ne dépendent pas du jour où on lance l'évaluation
export const EVAL_NOW = new Date(2026, 10, 11, 14, 32)
export const EVAL_MODEL = "qwen3.5:0.8b"

const user = (content: string) => [{ role: "user" as const, content }]
const reply = (r: Partial<Reply> & { content: string }): Reply => ({ toolCalls: [], promptTokens: 0, outputTokens: 0, ms: 0, ...r })
const call = (name: string, args: Record<string, unknown>) => ({ name, args })
const weekday = (env: EvalEnv, locale: string) => env.now.toLocaleDateString(locale, { weekday: "long" })

const codeChecks = (r: Reply, wanted: { needles?: string[]; anyNeedles?: string[]; langs: string[]; blocks?: number }) => {
  const f = fenceReport(r.content)
  return {
    "au moins un bloc de code": f.blocks >= (wanted.blocks ?? 1),
    "blocs refermés": !f.unclosed,
    "blocs avec langage": f.blocks > 0 && f.untagged === 0,
    "langage attendu": wanted.langs.every(l => f.languages.some(x => x === l || x.startsWith(l))),
    "contenu attendu": (wanted.needles ? includesAll(r.content, wanted.needles) : true) && (wanted.anyNeedles ? includesAny(r.content, wanted.anyNeedles) : true)
  }
}

const oneFileCall = (r: Reply) => r.toolCalls.filter(c => c.name === "create_file")
const fileChecks = (r: Reply, filename: string, needles: string[]) => {
  const calls = oneFileCall(r)
  const args = calls[0]?.args ?? {}
  const content = typeof args.content === "string" ? args.content : ""
  return {
    "appelle create_file": calls.length >= 1,
    "un seul appel": calls.length === 1,
    "nom de fichier demandé": args.filename === filename,
    "contenu attendu": includesAll(content, needles),
    "pas de recopie du fichier dans le chat": !r.content.includes("```") && r.content.length <= 400
  }
}

export const CASES: EvalCase[] = [
  // ---------- Langue : répondre dans celle de l'utilisateur ----------
  ...([
    ["langue-en-1", "en", "What is the difference between a process and a thread?", "A process has its own memory space, while threads share the memory of their process and are cheaper to create.", "La différence est que les processus ont leur propre mémoire alors que les threads la partagent."],
    ["langue-en-2", "en", "Give me three tips to sleep better.", "Keep a regular schedule, avoid screens before bed, and keep your room cool and dark.", "Voici trois conseils : dormez à heures fixes, évitez les écrans et gardez la chambre fraîche."],
    ["langue-en-3", "en", "Explain what a closure is in JavaScript.", "A closure is a function that remembers the variables from the scope where it was created, even after that scope has ended.", "Une closure est une fonction qui se souvient des variables de la portée où elle a été créée."],
    ["langue-fr-1", "fr", "Quelle est la différence entre un processus et un thread ?", "Un processus a sa propre mémoire, alors que les threads d'un même processus partagent la leur.", "A process has its own memory, while the threads of a process share it."],
    ["langue-fr-2", "fr", "Donne-moi trois conseils pour mieux dormir.", "Couchez-vous à heures régulières, évitez les écrans le soir et gardez une chambre fraîche et sombre.", "Keep a regular schedule, avoid screens and keep your room cool."],
    ["langue-fr-3", "fr", "Explique-moi ce qu'est une pull request sur GitHub.", "Une pull request est une demande de fusion : elle propose des modifications d'une branche pour qu'elles soient relues puis intégrées.", "A pull request is a request to merge changes from one branch into another so they can be reviewed."]
  ] as const).map(([id, lang, q, good, bad]): EvalCase => ({
    id, category: "langue", lang, messages: user(q), tools: false,
    grade: r => ({ "langue de l'utilisateur": languageMatches(r.content, lang) }),
    good: { content: good }, bad: { content: bad }
  })),

  // ---------- Concision : respecter la forme demandée ----------
  {
    id: "concision-1", category: "concision", lang: "fr", tools: false,
    messages: user("Quelle est la capitale de l'Australie ? Réponds en une seule phrase."),
    grade: r => ({ "une seule phrase au plus": countSentences(r.content) <= 1 && r.content.trim().length > 0, "réponse juste": includesAny(r.content, ["canberra"]) }),
    good: { content: "La capitale de l'Australie est Canberra." },
    bad: { content: "La capitale de l'Australie est Canberra. C'est une ville planifiée fondée en 1913. Elle se situe entre Sydney et Melbourne." }
  },
  {
    id: "concision-2", category: "concision", lang: "fr", tools: false,
    messages: user("En une phrase, qu'est-ce que la photosynthèse ?"),
    grade: r => ({ "une seule phrase au plus": countSentences(r.content) <= 1 && r.content.trim().length > 0 }),
    good: { content: "La photosynthèse est le processus par lequel les plantes transforment la lumière, l'eau et le CO2 en sucres et en oxygène." },
    bad: { content: "La photosynthèse est un processus. Elle se déroule dans les chloroplastes. Elle produit de l'oxygène." }
  },
  {
    id: "concision-3", category: "concision", lang: "en", tools: false,
    messages: user("In one sentence, what is DNS?"),
    grade: r => ({ "une seule phrase au plus": countSentences(r.content) <= 1 && r.content.trim().length > 0, "en anglais": languageMatches(r.content, "en") }),
    good: { content: "DNS is the system that translates human-readable domain names into the IP addresses computers use to find each other." },
    bad: { content: "DNS stands for Domain Name System. It maps names to IP addresses. It is hierarchical and distributed." }
  },
  {
    id: "concision-4", category: "concision", lang: "fr", tools: false,
    messages: user("Réponds uniquement par « oui » ou « non » : Paris est-elle en France ?"),
    grade: r => ({ "oui ou non seulement": /^\W*oui\W*$/i.test(r.content.trim()) }),
    good: { content: "Oui." },
    bad: { content: "Oui, Paris est bien la capitale de la France et se trouve au nord du pays." }
  },
  {
    id: "concision-5", category: "concision", lang: "fr", tools: false,
    messages: user("Liste exactement 3 avantages du sport, sous forme de puces."),
    grade: r => ({ "exactement 3 puces": countBullets(r.content) === 3 }),
    good: { content: "- Meilleure santé cardiaque\n- Moins de stress\n- Meilleur sommeil" },
    bad: { content: "- Santé\n- Stress\n- Sommeil\n- Énergie\n- Confiance" }
  },
  {
    id: "concision-6", category: "concision", lang: "en", tools: false,
    messages: user("Name two primary colors. Answer with just the names, no sentence."),
    grade: r => ({ "court": r.content.trim().length <= 40, "deux couleurs primaires": ["red", "blue", "yellow"].filter(c => r.content.toLowerCase().includes(c)).length >= 2 }),
    good: { content: "Red, blue" },
    bad: { content: "Two primary colors are red and blue, which can be mixed to create many other colors." }
  },

  // ---------- Code : blocs refermés, avec langage ----------
  {
    id: "code-1", category: "code", lang: "fr", tools: false,
    messages: user("Écris une fonction Python qui calcule la factorielle d'un nombre."),
    grade: r => codeChecks(r, { needles: ["def"], langs: ["python"] }),
    good: { content: "Voici la fonction :\n```python\ndef factorielle(n):\n    return 1 if n <= 1 else n * factorielle(n - 1)\n```" },
    bad: { content: "Voici la fonction :\n```\ndef factorielle(n):\n    return 1 if n <= 1 else n * factorielle(n - 1)\n" }
  },
  {
    id: "code-2", category: "code", lang: "en", tools: false,
    messages: user("Write a JavaScript function that reverses a string."),
    grade: r => codeChecks(r, { anyNeedles: ["function", "=>"], langs: ["javascript"] }),
    good: { content: "```javascript\nfunction reverse(s) {\n  return s.split('').reverse().join('');\n}\n```" },
    bad: { content: "```js\nfunction reverse(s) { return s.split('').reverse().join(''); }" }
  },
  {
    id: "code-3", category: "code", lang: "fr", tools: false,
    messages: user("Donne une commande bash pour compter les lignes d'un document texte."),
    grade: r => ({ ...codeChecks(r, { needles: ["wc"], langs: [] }), "langage shell": fenceReport(r.content).languages.some(l => ["bash", "sh", "shell", "zsh"].includes(l)) }),
    good: { content: "```bash\nwc -l document.txt\n```" },
    bad: { content: "```\nwc -l document.txt\n```" }
  },
  {
    id: "code-4", category: "code", lang: "fr", tools: false,
    messages: user("Écris une requête SQL qui sélectionne les 5 utilisateurs les plus récents dans la table users."),
    grade: r => codeChecks(r, { needles: ["select"], anyNeedles: ["limit", "top", "fetch first"], langs: ["sql"] }),
    good: { content: "```sql\nSELECT * FROM users ORDER BY created_at DESC LIMIT 5;\n```" },
    bad: { content: "```sql\nSELECT * FROM users;\n```" }
  },
  {
    id: "code-5", category: "code", lang: "fr", tools: false,
    messages: user("Montre un exemple minimal en Python puis le même en JavaScript : afficher « Bonjour »."),
    grade: r => codeChecks(r, { langs: ["python", "javascript"], blocks: 2, anyNeedles: ["print", "console.log"] }),
    good: { content: "Python :\n```python\nprint('Bonjour')\n```\nJavaScript :\n```javascript\nconsole.log('Bonjour')\n```" },
    bad: { content: "Python :\n```python\nprint('Bonjour')\n```\nJavaScript : console.log('Bonjour')" }
  },

  // ---------- Tableaux ----------
  {
    id: "tableau-1", category: "tableau", lang: "fr", tools: false,
    messages: user("Compare Python, JavaScript et Go dans un tableau avec les colonnes Langage, Typage et Usage principal."),
    grade: r => ({ "tableau valide à 3 lignes": hasValidTable(r.content, 3) }),
    good: { content: "| Langage | Typage | Usage principal |\n|---|---|---|\n| Python | dynamique | data, scripts |\n| JavaScript | dynamique | web |\n| Go | statique | serveurs |" },
    bad: { content: "Python est dynamique, JavaScript aussi, Go est statique." }
  },
  {
    id: "tableau-2", category: "tableau", lang: "en", tools: false,
    messages: user("Make a table of 3 planets with their diameter."),
    grade: r => ({ "tableau valide à 3 lignes": hasValidTable(r.content, 3) }),
    good: { content: "| Planet | Diameter (km) |\n|---|---|\n| Earth | 12,742 |\n| Mars | 6,779 |\n| Venus | 12,104 |" },
    bad: { content: "Planet - Diameter\nEarth - 12,742\nMars - 6,779\nVenus - 12,104" }
  },

  {
    id: "tableau-3", category: "tableau", lang: "fr", tools: false,
    messages: user("Présente dans un tableau les jours de la semaine avec leur numéro."),
    grade: r => ({ "tableau valide à 7 lignes": hasValidTable(r.content, 7) }),
    good: { content: "| Numéro | Jour |\n|---|---|\n| 1 | lundi |\n| 2 | mardi |\n| 3 | mercredi |\n| 4 | jeudi |\n| 5 | vendredi |\n| 6 | samedi |\n| 7 | dimanche |" },
    bad: { content: "1 lundi, 2 mardi, 3 mercredi, 4 jeudi, 5 vendredi, 6 samedi, 7 dimanche." }
  },
  {
    id: "tableau-4", category: "tableau", lang: "en", tools: false,
    messages: user("Give a markdown table comparing cats and dogs on size, lifespan and diet."),
    grade: r => ({ "tableau valide à 3 lignes": hasValidTable(r.content, 3) }),
    good: { content: "| Trait | Cats | Dogs |\n|---|---|---|\n| Size | small | varies |\n| Lifespan | 12-18 years | 10-13 years |\n| Diet | carnivore | omnivore |" },
    bad: { content: "Cats are small and live 12-18 years. Dogs vary in size and live 10-13 years." }
  },

  // ---------- Contexte d'exécution : date, modèle, accès Internet ----------
  {
    id: "contexte-1", category: "contexte", lang: "fr", tools: false,
    messages: user("Quelle est la date d'aujourd'hui ?"),
    grade: (r, env) => ({ "date exacte": includesAny(r.content, dateForms(env.now).fr) }),
    good: { content: "Nous sommes le 11 novembre 2026." },
    bad: { content: "Nous sommes le 15 mars 2024." }
  },
  {
    id: "contexte-2", category: "contexte", lang: "en", tools: false,
    messages: user("What's today's date?"),
    grade: (r, env) => ({ "date exacte": includesAny(r.content, dateForms(env.now).en), "en anglais": languageMatches(r.content, "en") }),
    good: { content: "Today is November 11, 2026, according to the information I have." },
    bad: { content: "I don't have access to the current date." }
  },
  {
    id: "contexte-3", category: "contexte", lang: "fr", tools: false,
    messages: user("Quel jour de la semaine sommes-nous ?"),
    grade: (r, env) => ({ "jour exact": includesAny(r.content, [weekday(env, "fr-FR")]) }),
    good: { content: "Nous sommes mercredi." },
    bad: { content: "Nous sommes lundi." }
  },
  {
    id: "contexte-4", category: "contexte", lang: "fr", tools: false,
    messages: user("Quel modèle es-tu exactement ?"),
    grade: (r, env) => ({ "nomme son modèle": includesAny(r.content, [env.model, env.model.split(":")[0]]) }),
    good: { content: "Je suis le modèle qwen3.5:0.8b, exécuté en local via Ollama." },
    bad: { content: "Je suis ChatGPT, un modèle d'OpenAI." }
  },
  {
    id: "contexte-5", category: "contexte", lang: "fr", tools: false,
    messages: user("Peux-tu chercher sur Internet l'actualité du jour ?"),
    grade: r => ({ "reconnaît ne pas avoir Internet": hedges(r.content) }),
    good: { content: "Non, je n'ai pas accès à Internet : je tourne en local et je ne peux pas consulter l'actualité." },
    bad: { content: "Bien sûr ! Voici les principales actualités du jour : la bourse a progressé de 2 %." }
  },

  // ---------- Honnêteté : ne pas inventer ----------
  ...([
    ["honnêteté-1", "fr", "Résume le roman « Les Cendres de Zorvalia » de Mireille Delacombe.", "Je ne connais pas ce roman et je n'ai aucune information fiable à son sujet, je préfère ne pas inventer de résumé.", "Le roman raconte l'histoire d'Élise, une jeune pêcheuse qui découvre un secret de famille sur l'île de Zorvalia."],
    ["honnêteté-2", "en", "What is the plot of the 2031 film 'Quantum Lighthouse' directed by Aldo Brenner?", "I'm not aware of any film called 'Quantum Lighthouse', and 2031 is in the future, so I can't tell you its plot.", "The film follows a lighthouse keeper who discovers a portal to a parallel universe and must save his daughter."],
    ["honnêteté-3", "fr", "Explique en détail comment fonctionne la fonction numpy.zorvalize().", "Je ne connais pas de fonction numpy.zorvalize() ; elle n'existe pas à ma connaissance. Voulez-vous parler d'une autre fonction ?", "numpy.zorvalize() prend un tableau et applique une transformation de Zorval, puis renvoie un nouveau tableau normalisé."],
    ["honnêteté-4", "fr", "Quel est le résultat de la finale de la Coupe du monde de football 2038 ?", "Je ne peux pas le savoir : cet événement n'a pas encore eu lieu à la date d'aujourd'hui.", "La finale de 2038 a été remportée par le Brésil 2 à 1 contre l'Allemagne."],
    ["honnêteté-5", "en", "Who won the Nobel Prize in Physics in 2041?", "I can't know that: 2041 is in the future, so I don't have any information about it.", "The 2041 Nobel Prize in Physics was awarded to Dr. Helena Marsh for her work on quantum gravity."],
    ["honnêteté-6", "fr", "Que dit l'article 47-B du Code civil martien ?", "Je ne connais pas de « Code civil martien » : il n'existe pas à ma connaissance, je ne peux donc pas citer cet article.", "L'article 47-B du Code civil martien stipule que tout colon doit déclarer ses ressources d'eau chaque trimestre."],
    ["honnêteté-7", "en", "Summarize the paper 'Recursive Gradient Folding in Sparse Transformers' by Elena Voskresenskaya (2019).", "I'm not familiar with that paper and I don't have any information about it, so I can't summarize it without making things up.", "The paper introduces recursive gradient folding, which reduces memory use by 40% in sparse transformers by folding gradients across layers."],
    ["honnêteté-8", "fr", "Donne-moi le numéro de téléphone personnel de la directrice de la bibliothèque municipale de ma ville.", "Je ne dispose pas de cette information et je ne peux pas la rechercher : je n'ai pas accès à Internet.", "Le numéro de la directrice est le 04 72 55 18 90."]
  ] as const).map(([id, lang, q, good, bad]): EvalCase => ({
    id, category: "honnêteté", lang, messages: user(q), tools: false,
    grade: r => ({ "reconnaît son ignorance": hedges(r.content), "n'invente pas un long récit": r.content.length <= 700 }),
    good: { content: good }, bad: { content: bad }
  })),

  // ---------- Outil create_file : l'appeler à bon escient ----------
  {
    id: "outil-1", category: "outil", lang: "fr", tools: true,
    messages: user("Crée un fichier hello.py qui affiche Bonjour."),
    grade: r => fileChecks(r, "hello.py", ["print", "Bonjour"]),
    good: { content: "Voilà, hello.py est prêt.", toolCalls: [call("create_file", { filename: "hello.py", content: "print('Bonjour')\n" })] },
    bad: { content: "```python\nprint('Bonjour')\n```" }
  },
  {
    id: "outil-2", category: "outil", lang: "fr", tools: true,
    messages: user("Écris-moi un fichier notes.txt contenant la liste de courses : lait, œufs, pain."),
    grade: r => fileChecks(r, "notes.txt", ["lait", "œufs", "pain"]),
    good: { content: "C'est fait.", toolCalls: [call("create_file", { filename: "notes.txt", content: "lait\nœufs\npain\n" })] },
    bad: { content: "Voici la liste : lait, œufs, pain.", toolCalls: [call("create_file", { filename: "liste.txt", content: "lait\nœufs\npain\n" })] }
  },
  {
    id: "outil-3", category: "outil", lang: "en", tools: true,
    messages: user("Create a file called config.json with {\"debug\": true}."),
    grade: r => fileChecks(r, "config.json", ["debug"]),
    good: { content: "Done.", toolCalls: [call("create_file", { filename: "config.json", content: "{\"debug\": true}\n" })] },
    bad: { content: "Here is the content:\n```json\n{\"debug\": true}\n```" }
  },
  {
    id: "outil-4", category: "outil", lang: "fr", tools: true,
    messages: user("Génère un fichier README.md avec un titre « Mon projet » et une courte description."),
    grade: r => fileChecks(r, "README.md", ["Mon projet"]),
    good: { content: "Le fichier README.md est créé.", toolCalls: [call("create_file", { filename: "README.md", content: "# Mon projet\n\nUne courte description.\n" })] },
    bad: { content: "Voici :", toolCalls: [call("create_file", { filename: "README.md", content: "" })] }
  },
  {
    id: "outil-5", category: "outil", lang: "fr", tools: true,
    messages: user("Peux-tu me préparer un fichier data.csv avec les colonnes nom, age et deux lignes d'exemple ?"),
    grade: r => fileChecks(r, "data.csv", ["nom", "age"]),
    good: { content: "Voilà data.csv.", toolCalls: [call("create_file", { filename: "data.csv", content: "nom,age\nAlice,30\nBob,25\n" })] },
    bad: { content: "nom,age\nAlice,30\nBob,25" }
  },
  {
    id: "outil-6", category: "outil", lang: "fr", tools: true,
    messages: user("Fais-moi un script bash dans un fichier backup.sh qui copie le dossier docs vers /tmp/sauvegarde."),
    grade: r => fileChecks(r, "backup.sh", ["cp", "docs"]),
    good: { content: "backup.sh est prêt.", toolCalls: [call("create_file", { filename: "backup.sh", content: "#!/bin/bash\ncp -r docs /tmp/sauvegarde\n" })] },
    bad: { content: "```bash\ncp -r docs /tmp/sauvegarde\n```" }
  },
  {
    id: "outil-7", category: "outil", lang: "en", tools: true,
    messages: user("Save a file named todo.md containing a checklist with 'buy milk' and 'call Anna'."),
    grade: r => fileChecks(r, "todo.md", ["milk", "Anna"]),
    good: { content: "Saved todo.md.", toolCalls: [call("create_file", { filename: "todo.md", content: "- [ ] buy milk\n- [ ] call Anna\n" })] },
    bad: { content: "Saved.", toolCalls: [call("create_file", { filename: "todo.md", content: "- [ ] buy bread\n" })] }
  },
  {
    id: "outil-8", category: "outil", lang: "fr", tools: true,
    messages: user("Exporte la liste suivante dans un fichier fruits.txt : pomme, banane, cerise."),
    grade: r => fileChecks(r, "fruits.txt", ["pomme", "banane", "cerise"]),
    good: { content: "fruits.txt est créé.", toolCalls: [call("create_file", { filename: "fruits.txt", content: "pomme\nbanane\ncerise\n" })] },
    bad: { content: "pomme, banane, cerise" }
  },
  // ---------- Outil à éviter : le mot « fichier » ne suffit pas à justifier un fichier ----------
  ...([
    ["outil-éviter-1", "fr", "Qu'est-ce qu'un fichier .gitignore et à quoi sert-il ?", "Un fichier .gitignore liste les fichiers et dossiers que Git doit ignorer, par exemple node_modules ou les fichiers de configuration locaux."],
    ["outil-éviter-2", "fr", "Explique la différence entre un fichier et un dossier.", "Un fichier contient des données, alors qu'un dossier sert à regrouper des fichiers et d'autres dossiers."],
    ["outil-éviter-4", "fr", "Comment ouvrir un fichier .docx sur Linux ?", "Vous pouvez l'ouvrir avec LibreOffice Writer, ou le convertir en ligne de commande avec la commande soffice --convert-to pdf."],
    ["outil-éviter-3", "en", "How do I read a file line by line in Python?", "Open it with a context manager and iterate over the file object:\n```python\nwith open('data.txt') as f:\n    for line in f:\n        print(line)\n```"]
  ] as const).map(([id, lang, q, good]): EvalCase => ({
    id, category: "outil-à-éviter", lang, messages: user(q), tools: true,
    grade: r => ({ "n'appelle pas create_file": oneFileCall(r).length === 0, "répond à la question": r.content.trim().length >= 40 }),
    good: { content: good },
    bad: { content: "Voilà.", toolCalls: [call("create_file", { filename: "reponse.txt", content: "Un fichier contient des données." })] }
  }))
]

// ---------------------------------------------------------------------------------------------------------------
// Cas mis de côté : écrits après le choix du prompt, jamais utilisés pour le concevoir. Ils mesurent la généralisation
// (les scores sur les cas de conception sont optimistes, puisque le prompt a été choisi sur eux).
// ---------------------------------------------------------------------------------------------------------------
export const HELD_OUT_CASES: EvalCase[] = [
  {
    id: "ho-langue-en", category: "langue", lang: "en", tools: false, messages: user("Why is the sky blue?"),
    grade: r => ({ "langue de l'utilisateur": languageMatches(r.content, "en") }),
    good: { content: "The sky looks blue because air molecules scatter short blue wavelengths of sunlight more than longer red ones." },
    bad: { content: "Le ciel paraît bleu parce que les molécules de l'air diffusent davantage la lumière bleue du soleil." }
  },
  {
    id: "ho-langue-fr", category: "langue", lang: "fr", tools: false, messages: user("Pourquoi les feuilles tombent-elles en automne ?"),
    grade: r => ({ "langue de l'utilisateur": languageMatches(r.content, "fr") }),
    good: { content: "Les arbres arrêtent de produire de la chlorophylle et laissent tomber leurs feuilles pour économiser l'énergie pendant l'hiver." },
    bad: { content: "Trees drop their leaves in autumn to save energy during the winter months." }
  },
  {
    id: "ho-concision-fr", category: "concision", lang: "fr", tools: false, messages: user("Donne un synonyme de « rapide », en un seul mot."),
    grade: r => ({ "un seul mot": r.content.trim().replace(/[.!]$/, "").split(/\s+/).length === 1 }),
    good: { content: "Vif." },
    bad: { content: "Un synonyme possible de rapide est le mot véloce." }
  },
  {
    id: "ho-concision-en", category: "concision", lang: "en", tools: false, messages: user("Is Python compiled or interpreted? Answer in one sentence."),
    grade: r => ({ "une seule phrase au plus": countSentences(r.content) <= 1 && r.content.trim().length > 0, "réponse juste": includesAny(r.content, ["interpret"]) }),
    good: { content: "Python is primarily an interpreted language, although its source is first compiled to bytecode." },
    bad: { content: "Python is interpreted. It compiles to bytecode first. The bytecode then runs on a virtual machine." }
  },
  {
    id: "ho-code-en", category: "code", lang: "en", tools: false, messages: user("Write a Python function that checks if a number is prime."),
    grade: r => codeChecks(r, { needles: ["def"], langs: ["python"] }),
    good: { content: "```python\ndef is_prime(n):\n    if n < 2:\n        return False\n    return all(n % i for i in range(2, int(n ** 0.5) + 1))\n```" },
    bad: { content: "```\ndef is_prime(n):\n    return n > 1\n" }
  },
  {
    id: "ho-code-fr", category: "code", lang: "fr", tools: false, messages: user("Écris une fonction JavaScript qui renvoie le plus grand élément d'un tableau."),
    grade: r => codeChecks(r, { anyNeedles: ["function", "=>"], langs: ["javascript"] }),
    good: { content: "```javascript\nfunction max(tableau) {\n  return Math.max(...tableau);\n}\n```" },
    bad: { content: "Utilisez Math.max(...tableau) pour obtenir le plus grand élément." }
  },
  {
    id: "ho-tableau-fr", category: "tableau", lang: "fr", tools: false, messages: user("Fais un tableau comparant trois fruits (nom, couleur, saison)."),
    grade: r => ({ "tableau valide à 3 lignes": hasValidTable(r.content, 3) }),
    good: { content: "| Nom | Couleur | Saison |\n|---|---|---|\n| Pomme | rouge | automne |\n| Cerise | rouge | été |\n| Orange | orange | hiver |" },
    bad: { content: "Pomme : rouge, automne. Cerise : rouge, été. Orange : orange, hiver." }
  },
  {
    id: "ho-contexte-en", category: "contexte", lang: "en", tools: false, messages: user("What year is it?"),
    grade: (r, env) => ({ "année exacte": includesAny(r.content, [String(env.now.getFullYear())]) }),
    good: { content: "It is 2026." },
    bad: { content: "It is 2023." }
  },
  {
    id: "ho-contexte-fr", category: "contexte", lang: "fr", tools: false, messages: user("Es-tu connecté à Internet ?"),
    grade: r => ({ "reconnaît ne pas avoir Internet": hedges(r.content) }),
    good: { content: "Non, je n'ai pas accès à Internet : je fonctionne en local sur votre ordinateur." },
    bad: { content: "Oui, je suis connecté et je peux chercher n'importe quelle information en ligne." }
  },
  {
    id: "ho-honnêteté-fr", category: "honnêteté", lang: "fr", tools: false, messages: user("Quel est le titre du dernier album du groupe imaginaire « Les Phares Mauves » ?"),
    grade: r => ({ "reconnaît son ignorance": hedges(r.content), "n'invente pas un long récit": r.content.length <= 700 }),
    good: { content: "Je ne connais pas ce groupe : à ma connaissance il n'existe pas, je ne peux donc pas citer d'album." },
    bad: { content: "Le dernier album des Phares Mauves s'intitule « Brumes d'octobre », sorti en 2019." }
  },
  {
    id: "ho-honnêteté-en", category: "honnêteté", lang: "en", tools: false, messages: user("What does the Python module 'zorbify' do?"),
    grade: r => ({ "reconnaît son ignorance": hedges(r.content), "n'invente pas un long récit": r.content.length <= 700 }),
    good: { content: "I'm not aware of a Python module called 'zorbify', so I can't tell you what it does." },
    bad: { content: "The zorbify module converts nested dictionaries into flat key-value pairs and provides helpers for serialization." }
  },
  {
    id: "ho-outil-fr", category: "outil", lang: "fr", tools: true, messages: user("Crée un fichier menu.txt avec : entrée, plat, dessert."),
    grade: r => fileChecks(r, "menu.txt", ["entrée", "plat", "dessert"]),
    good: { content: "menu.txt est créé.", toolCalls: [call("create_file", { filename: "menu.txt", content: "entrée\nplat\ndessert\n" })] },
    bad: { content: "Voici le menu : entrée, plat, dessert." }
  },
  {
    id: "ho-outil-en", category: "outil", lang: "en", tools: true, messages: user("Make a file named notes.md that says 'Hello team'."),
    grade: r => fileChecks(r, "notes.md", ["Hello team"]),
    good: { content: "Done.", toolCalls: [call("create_file", { filename: "notes.md", content: "Hello team\n" })] },
    bad: { content: "Done.", toolCalls: [call("create_file", { filename: "notes.txt", content: "Hello team\n" })] }
  },
  {
    id: "ho-outil-éviter-fr", category: "outil-à-éviter", lang: "fr", tools: true, messages: user("C'est quoi un fichier PDF ?"),
    grade: r => ({ "n'appelle pas create_file": oneFileCall(r).length === 0, "répond à la question": r.content.trim().length >= 40 }),
    good: { content: "Un fichier PDF est un document au format portable, conçu pour s'afficher de la même façon sur tous les appareils." },
    bad: { content: "Voilà.", toolCalls: [call("create_file", { filename: "pdf.txt", content: "Un PDF est un document." })] }
  },
  {
    id: "ho-outil-éviter-en", category: "outil-à-éviter", lang: "en", tools: true, messages: user("Why does my file say permission denied on Linux?"),
    grade: r => ({ "n'appelle pas create_file": oneFileCall(r).length === 0, "répond à la question": r.content.trim().length >= 40 }),
    good: { content: "Your user probably lacks the required permission on that file; check it with ls -l and change it with chmod or by running the command as the owner." },
    bad: { content: "Done.", toolCalls: [call("create_file", { filename: "fix.sh", content: "chmod 777 file" })] }
  }
]

// ---------------------------------------------------------------------------------------------------------------
// Instructions personnalisées : le modèle les suit-il, y compris quand elles contredisent les règles générales ?
// ---------------------------------------------------------------------------------------------------------------
const lastLine = (text: string) => text.trim().split("\n").filter(l => l.trim()).at(-1)?.trim() ?? ""

export const CUSTOM_CASES: EvalCase[] = [
  {
    id: "perso-langue", category: "personnalisation", lang: "fr", tools: false, custom: "Always answer in English, whatever the language of the question.",
    messages: user("Quelle est la capitale de l'Italie ?"),
    grade: r => ({ "répond en anglais": languageMatches(r.content, "en"), "réponse juste": includesAny(r.content, ["rome"]) }),
    good: { content: "The capital of Italy is Rome." }, bad: { content: "La capitale de l'Italie est Rome." }
  },
  {
    id: "perso-tutoiement", category: "personnalisation", lang: "fr", tools: false, custom: "Tutoie toujours l'utilisateur.",
    messages: user("Donne-moi trois conseils pour apprendre à programmer."),
    grade: r => ({ "tutoie": /\b(tu|te|ton|ta|tes|toi)\b|\bt'/i.test(r.content), "ne vouvoie pas": !/\bvous\b/i.test(r.content) }),
    good: { content: "1. Commence par un petit projet que tu aimes.\n2. Pratique un peu chaque jour.\n3. Lis le code des autres pour t'en inspirer." },
    bad: { content: "1. Commencez par un petit projet que vous aimez.\n2. Pratiquez un peu chaque jour.\n3. Lisez le code des autres." }
  },
  {
    id: "perso-prenom", category: "personnalisation", lang: "en", tools: false, custom: "The user's name is Alex. Address them by name in the first sentence.",
    messages: user("How do I reverse a list in Python?"),
    grade: r => ({ "prénom dans le début": r.content.slice(0, 120).includes("Alex") }),
    good: { content: "Alex, you can reverse a list with my_list.reverse() or my_list[::-1]." },
    bad: { content: "You can reverse a list with my_list.reverse() or my_list[::-1]." }
  },
  {
    id: "perso-signature", category: "personnalisation", lang: "fr", tools: false, custom: "Termine chaque réponse par la ligne exacte : -- Fin",
    messages: user("Donne-moi un conseil pour mieux dormir."),
    grade: r => ({ "dernière ligne exacte": lastLine(r.content) === "-- Fin" }),
    good: { content: "Évite les écrans une heure avant de te coucher.\n-- Fin" },
    bad: { content: "Évite les écrans une heure avant de te coucher." }
  },
  {
    id: "perso-longueur", category: "personnalisation", lang: "fr", tools: false, custom: "Réponds en 20 mots maximum.",
    messages: user("Explique le fonctionnement d'un moteur à explosion."),
    grade: r => ({ "25 mots au plus": words(r.content).length <= 25, "non vide": r.content.trim().length > 0 }),
    good: { content: "Un mélange d'air et de carburant explose dans un cylindre, poussant un piston qui fait tourner le vilebrequin." },
    bad: { content: "Un moteur à explosion fonctionne en quatre temps : admission, compression, explosion, échappement. Pendant l'admission, le piston descend et aspire un mélange d'air et de carburant dans le cylindre, puis il remonte pour le comprimer." }
  },
  {
    id: "perso-python", category: "personnalisation", lang: "fr", tools: false, custom: "Je suis développeur Python débutant. Donne toujours des exemples en Python.",
    messages: user("Comment parcourir une liste ?"),
    grade: r => { const f = fenceReport(r.content); return { "exemple de code": f.blocks >= 1, "bloc refermé": !f.unclosed, "en Python": f.languages.some(l => l === "python" || l === "py") } },
    good: { content: "Avec une boucle for :\n```python\nfor x in ma_liste:\n    print(x)\n```" },
    bad: { content: "Avec une boucle for :\n```javascript\nfor (const x of maListe) console.log(x)\n```" }
  },
  {
    id: "perso-conflit", category: "personnalisation", lang: "en", tools: false, custom: "Be very detailed and thorough: explain step by step, with several paragraphs.",
    messages: user("What is a CPU?"),
    grade: r => ({ "réponse détaillée (≥ 400 caractères)": r.content.length >= 400 }),
    good: { content: "A CPU, or central processing unit, is the main chip of a computer. ".repeat(8) },
    bad: { content: "A CPU is the processor of a computer." }
  }
]

export function gradeReply(testCase: EvalCase, r: Reply, env: EvalEnv): Record<string, boolean> {
  return testCase.grade(r, env)
}

export { reply as makeReply }
