import { buildSummarizerMessages, cleanSummary, mergeNotes, notesMaxChars, serializeMessages, summaryBody, summaryTargetTokens, userNotes } from "../lib/compaction"
import { detectLanguage, type Language } from "./graders"
import { mean, percent, wilson, type Proportion } from "./stats"
import type { ChatMessage } from "./types"
import type { ChatFn } from "./runner"

// ---------------------------------------------------------------------------------------------------------------
// Évaluation du prompt de compaction : un bon résumé garde les faits, n'en invente aucun et reste plus court.
// ---------------------------------------------------------------------------------------------------------------

export type Fact = string | string[]   // un tableau = plusieurs écritures acceptées

export interface SummaryCase {
  id: string
  lang: Language
  previous?: string                    // résumé précédent (fusion d'un résumé roulant)
  messages: { role: "user" | "assistant"; content: string }[]
  facts: Fact[]                        // à retrouver dans le résumé
  forbidden: string[]                  // détails plausibles mais absents de la source : leur présence prouve une invention
  good: string
  bad: string
}

export const SUMMARY_CASES: SummaryCase[] = [
  {
    id: "voyage-fr", lang: "fr",
    messages: [
      { role: "user", content: "Je prépare un voyage à Lisbonne du 14 au 18 mars avec ma sœur Camille. Notre budget total est de 900 €." },
      { role: "assistant", content: "Super idée ! Pour 4 nuits, je te conseille un hôtel dans le quartier de la Baixa, comptez environ 85 € la nuit, soit 340 € au total. Il vous resterait 560 € pour les repas et les visites." },
      { role: "user", content: "Merci, tu peux détailler un peu ?" },
      { role: "assistant", content: "Bien sûr. Lisbonne est une ville de collines, donc prévoyez de bonnes chaussures de marche : les pavés deviennent glissants quand il pleut. Les quartiers les plus agréables à explorer à pied sont l'Alfama, avec ses ruelles étroites et ses fados le soir, et le Chiado, plus commerçant. Pour les repas, les petits restaurants de quartier proposent des plats du jour copieux à prix doux ; évitez les terrasses les plus touristiques près des grandes places. Pensez aussi à valider votre carte de transport à chaque trajet, et à garder un peu de monnaie pour les cafés. Enfin, le soir, les miradouros offrent de superbes vues sur le fleuve, idéales pour terminer la journée." },
      { role: "user", content: "Parfait. Qu'est-ce qu'on ne doit pas rater ?" },
      { role: "assistant", content: "La tour de Belém, le monastère des Hiéronymites et un pastel de nata chez Manteigaria. Le tram 28 est pittoresque mais bondé." },
      { role: "user", content: "On veut aussi faire Sintra. C'est faisable en une journée ?" },
      { role: "assistant", content: "Oui, prenez le train depuis la gare de Rossio, environ 40 minutes. Je suggère d'y aller le 16 mars." },
      { role: "user", content: "D'accord, on réserve l'hôtel Baixa Central à 85 € la nuit et on part à Sintra le 16 mars. Il reste à Camille de réserver les billets d'avion." }
    ],
    facts: ["Lisbonne", "14", "18 mars", "Camille", "900", "Sintra", "16 mars", "Baixa"],
    forbidden: ["Porto", "Madrid", "Barcelone", "Faro"],
    good: "- Voyage à Lisbonne du 14 au 18 mars avec Camille, budget de 900 €.\n- Hôtel Baixa Central (quartier de la Baixa), 85 € la nuit.\n- Sintra prévu le 16 mars en train depuis Rossio.\n- À faire : Camille réserve les billets d'avion.",
    bad: "- Voyage à Porto avec un budget de 1200 €.\n- Visite de Sintra prévue."
  },
  {
    id: "bug-python-fr", lang: "fr",
    messages: [
      { role: "user", content: "Mon script export_csv.py plante avec KeyError: 'prix' quand je lis le fichier ventes.csv." },
      { role: "assistant", content: "Le message indique que la colonne 'prix' n'existe pas. Dans votre fichier, elle s'appelle probablement 'Prix' avec une majuscule. Affichez df.columns pour vérifier." },
      { role: "user", content: "Merci, des conseils pour éviter ça à l'avenir ?" },
      { role: "assistant", content: "Une bonne pratique consiste à normaliser les noms de colonnes dès le chargement : passez-les en minuscules, supprimez les espaces et remplacez les caractères accentués. Cela rend le reste du script plus robuste, surtout quand les fichiers proviennent de plusieurs sources. Vous pouvez aussi écrire un petit test qui vérifie la présence des colonnes attendues et qui affiche un message clair si l'une d'elles manque, plutôt qu'une trace d'exécution difficile à lire. Pensez également à documenter le format attendu du fichier dans le README du projet, pour que chacun sache à quoi s'attendre." },
      { role: "user", content: "Oui, c'est écrit Prix. J'utilise pandas 2.1." },
      { role: "assistant", content: "Alors renommez la colonne : df = df.rename(columns={'Prix': 'prix'}) juste après le read_csv. Avec pandas 2.1 cela fonctionne sans autre changement." },
      { role: "user", content: "Ça marche ! Mais maintenant l'export est très lent : 45 secondes pour 200 000 lignes." },
      { role: "assistant", content: "Utilisez chunksize=50000 dans read_csv et écrivez avec to_csv(mode='a'). Vous devriez descendre sous les 10 secondes." }
    ],
    facts: ["export_csv.py", "KeyError", "Prix", "pandas", "45", ["200 000", "200000", "200,000"], "chunksize"],
    forbidden: ["numpy", "Excel", "SQLite"],
    good: "- export_csv.py plantait avec KeyError: 'prix' en lisant ventes.csv : la colonne s'appelle 'Prix' ; corrigé avec df.rename (pandas 2.1).\n- Export lent : 45 s pour 200 000 lignes ; solution proposée : chunksize=50000 dans read_csv et to_csv(mode='a').",
    bad: "- Le script export_csv.py a un bug avec numpy.\n- L'export prend 2 minutes."
  },
  {
    id: "reunion-en", lang: "en",
    messages: [
      { role: "user", content: "Notes from today's Orion meeting. The launch date was April 30 but the QA team found 12 critical bugs." },
      { role: "assistant", content: "Understood. With 12 critical bugs open, April 30 looks risky. Who owns the fix list?" },
      { role: "user", content: "Thanks, any general advice for handling a delay like this?" },
      { role: "assistant", content: "In general, when a launch slips, it helps to communicate early and clearly with every stakeholder, explaining the reason for the delay and what is being done about it. Teams usually appreciate a short written update that lists the main risks, the mitigation plan and the next checkpoint. It also helps to keep the daily stand-up focused on blockers, and to avoid adding new features while the stabilisation work is under way. Finally, make sure the support team is briefed before the new date so they can answer questions confidently." },
      { role: "user", content: "Dana owns the bug list. Marco handles the release notes. We decided to postpone the launch to May 21." },
      { role: "assistant", content: "Noted. Postponing to May 21 gives three more weeks. Do you want a checklist?" },
      { role: "user", content: "Yes. Also the budget stays at 40k euros and the next review is on May 7." },
      { role: "assistant", content: "Here's a short checklist: triage bugs, retest, freeze code on May 14, update release notes, final review." }
    ],
    facts: ["Orion", "April 30", "12", "Dana", "Marco", "May 21", ["40k", "40,000", "40 000"], "May 7"],
    forbidden: ["June", "Sarah", "March 15"],
    good: "- Orion launch postponed from April 30 to May 21 after QA found 12 critical bugs.\n- Dana owns the bug list, Marco the release notes.\n- Budget unchanged at 40k euros; next review May 7; code freeze May 14.",
    bad: "- The Orion launch moves to June because of 20 bugs; Sarah owns the list."
  },
  {
    id: "api-fr", lang: "fr",
    messages: [
      { role: "user", content: "L'API de paiement renvoie 429 sur /v2/orders. La limite est de 120 requêtes par minute." },
      { role: "assistant", content: "Ajoutez un backoff exponentiel et lisez l'en-tête Retry-After. Évitez de dépasser 2 requêtes par seconde." },
      { role: "user", content: "Merci, un conseil pour rendre le client plus robuste ?" },
      { role: "assistant", content: "Configurez des délais d'attente raisonnables, relancez uniquement les requêtes idempotentes et séparez clairement les erreurs temporaires des erreurs définitives. Une bonne journalisation, avec des identifiants de corrélation, facilite grandement le diagnostic en production. Enfin, écrivez quelques tests automatisés qui simulent des réponses d'erreur du serveur, afin de vérifier que votre logique de nouvelle tentative se comporte comme prévu sans dépasser les limites imposées par le fournisseur de paiement." },
      { role: "user", content: "Le token expire après 3600 secondes, on le rafraîchit toutes les 55 minutes." },
      { role: "assistant", content: "C'est correct. Prévoyez un rafraîchissement automatique dans le client http." },
      { role: "user", content: "OK, je crée un fichier api_client.py avec une classe PaymentClient qui gère ça." },
      { role: "assistant", content: "Parfait. Pensez à journaliser les erreurs 429 avec l'identifiant de commande." }
    ],
    facts: ["429", "/v2/orders", "120", "3600", ["55 minutes", "55 min"], "api_client.py", "PaymentClient"],
    forbidden: ["500", "OAuth", "Stripe"],
    good: "- L'API renvoie 429 sur /v2/orders (limite 120 requêtes/minute) : backoff exponentiel et Retry-After.\n- Token expirant après 3600 s, rafraîchi toutes les 55 minutes.\n- Création de api_client.py avec la classe PaymentClient.",
    bad: "- L'API de paiement Stripe renvoie 500 ; le token OAuth expire après 1 heure."
  },
  {
    id: "fusion-fr", lang: "fr",
    previous: "- Voyage à Lisbonne du 14 au 18 mars avec Camille, budget de 900 €.\n- Hôtel Baixa Central réservé, 85 € la nuit.",
    messages: [
      { role: "user", content: "Pour le dîner du 15 mars, tu me conseilles quoi ?" },
      { role: "user", content: "Merci, des conseils pour ce genre de restaurant ?" },
      { role: "assistant", content: "Dans ce type d'établissement, on mange souvent au comptoir ou à de grandes tables partagées, l'ambiance est animée et le service rapide. Les fruits de mer se commandent généralement au poids, donc n'hésitez pas à demander le prix avant de passer commande. Prévoyez d'arriver un peu en avance, car l'attente peut être longue aux heures de pointe, et gardez de la place pour le dessert maison. Une bonne manière de découvrir la cuisine locale consiste à partager plusieurs plats au centre de la table." },
      { role: "assistant", content: "La Cervejaria Ramiro est une référence pour les fruits de mer, mais il faut réserver." },
      { role: "user", content: "Parfait, on réserve la Cervejaria Ramiro pour 20 h le 15 mars, une table de 2." }
    ],
    facts: ["Lisbonne", "Camille", "900", "Baixa", "Cervejaria Ramiro", ["20 h", "20h", "20:00"], "15 mars"],
    forbidden: ["Porto", "Madrid"],
    good: "- Voyage à Lisbonne du 14 au 18 mars avec Camille, budget 900 €, hôtel Baixa Central à 85 € la nuit.\n- Dîner réservé à la Cervejaria Ramiro le 15 mars à 20 h, table de 2.",
    bad: "- Voyage à Lisbonne ; dîner à Madrid."
  }
]

// ----- Correcteur ----------------------------------------------------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ")
const digitsOnly = (s: string) => s.replace(/[^\d]/g, "")

// Nombres à au moins deux chiffres d'un texte, sans les séparateurs (« 200 000 » devient « 200000 »)
export function numbersIn(text: string): string[] {
  const withoutListNumbers = text.replace(/^\s*\d+[.)]\s/gm, "")
  return (withoutListNumbers.match(/\d[\d\s.,'’]*\d/g) ?? []).map(digitsOnly).filter(n => n.length >= 2)
}

export interface SummaryGrade {
  recall: number
  missing: string[]
  inventedNumbers: string[]
  checks: Record<string, boolean>
}

// `modelText` : ce que le modèle a écrit (la langue se juge là-dessus, pas sur les extraits recopiés des messages de l'utilisateur)
export function gradeSummary(summary: string, c: SummaryCase, modelText: string = summary): SummaryGrade {
  const text = squash(summary)
  const found = c.facts.map(f => (Array.isArray(f) ? f : [f]).some(alt => text.includes(squash(alt))))
  const missing = c.facts.filter((_, i) => !found[i]).map(f => (Array.isArray(f) ? f[0] : f))
  const source = (c.previous ? c.previous + "\n" : "") + c.messages.map(m => m.content).join("\n")
  const sourceNumbers = new Set(numbersIn(source))
  const sourceDigits = digitsOnly(source)
  // Un nombre est « inventé » s'il n'apparaît dans la source ni tel quel, ni comme suite de chiffres
  const invented = [...new Set(numbersIn(summary))].filter(n => !sourceNumbers.has(n) && !sourceDigits.includes(n))
  return {
    recall: found.filter(Boolean).length / c.facts.length,
    missing,
    inventedNumbers: invented,
    checks: {
      "tous les faits conservés": missing.length === 0,
      "aucun nombre inventé": invented.length === 0,
      "aucun détail étranger à la source": !c.forbidden.some(w => text.includes(squash(w))),
      "résumé du modèle nettement plus court que la source": modelText.length <= source.length * 0.6,
      "langue de la conversation": detectLanguage(modelText) === c.lang,
      "sans commentaire sur la tâche": !/^\W*(voici|here is|here's|résumé\s*:|summary\s*:)/i.test(summary.trim()) && !/\b(ce résumé|this summary)\b/i.test(summary)
    }
  }
}

// ----- Variantes de prompt -------------------------------------------------------------------------------------

export interface SummaryVariant {
  id: string
  label: string
  serialize?: (messages: SummaryCase["messages"]) => string   // mise en forme de la conversation (par défaut : celle de l'application)
  build: (previous: string | undefined, chunkText: string, target: number) => ChatMessage[]
}

const userBlock = (previous: string | undefined, chunkText: string) =>
  (previous ? `RÉSUMÉ ACTUEL :\n${previous.trim()}\n\n` : "") + `ÉCHANGES${previous ? " À AJOUTER AU RÉSUMÉ" : ""} :\n${chunkText}\n\n`

const SAME_LANGUAGE_SYSTEM =
  "Tu résumes des conversations pour qu'elles tiennent dans une mémoire limitée. " +
  "Écris le résumé dans la langue de la conversation. Chaque puce contient un fait précis. " +
  "Recopie à l'identique les noms propres, nombres, dates, noms de fichiers, identifiants et extraits de code. " +
  "N'ajoute aucune information absente de la conversation. Ne commente pas ta tâche."

const EXAMPLE = `

Exemple de format (autre sujet) :
ÉCHANGES : UTILISATEUR : Je veux faire un gâteau pour 8 personnes, j'ai 250 g de farine. ASSISTANT : Il vous faut 300 g de farine et 4 œufs. UTILISATEUR : Ok, je prends la recette de Tatie Jo, cuisson 35 min à 180 °C.
RÉSUMÉ :
- Gâteau pour 8 personnes ; l'utilisateur a 250 g de farine, il en faut 300 g et 4 œufs.
- Recette retenue : celle de Tatie Jo, cuisson 35 min à 180 °C.`

const LEGACY_SYSTEM =
  "Tu résumes des conversations pour qu'elles tiennent dans une mémoire limitée. " +
  "Tu écris en français, de façon factuelle et dense. Tu recopies exactement les noms, nombres, dates et noms de fichiers. " +
  "Tu n'inventes rien : une information absente des échanges ne doit pas apparaître. Tu ne commentes jamais ta tâche."

const EN_SYSTEM =
  "You summarize conversations so they fit in a limited memory. Write the summary in the same language as the conversation. " +
  "Each bullet holds one precise fact. Copy names, numbers, dates, file names, identifiers and code snippets exactly as written: never translate or change them. " +
  "Add nothing that is not in the conversation. Do not comment on your task."

const enUser = (previous: string | undefined, chunkText: string, target: number, shape: string) =>
  (previous ? `CURRENT SUMMARY:\n${previous.trim()}\n\n` : "") + `CONVERSATION${previous ? " TO ADD TO THE SUMMARY" : ""}:\n${chunkText}\n\n` +
  `${previous ? "Rewrite the summary to include this conversation" : "Summarize this conversation"}${shape} (about ${target} tokens at most). Reply with the summary only.`

export const SUMMARY_VARIANTS: SummaryVariant[] = [
  {
    id: "actuel",
    label: "Prompt d'origine de l'application (français, étiquettes françaises, quelle que soit la conversation) : copie figée pour la comparaison",
    serialize: messages => messages.map(m => `${m.role === "user" ? "UTILISATEUR" : "ASSISTANT"} :\n${m.content}`).join("\n\n---\n\n"),
    build: (previous, chunkText, target) => [
      { role: "system", content: LEGACY_SYSTEM },
      {
        role: "user",
        content:
          (previous ? `RÉSUMÉ ACTUEL :\n${previous.trim()}\n\n` : "") +
          `ÉCHANGES${previous ? " À AJOUTER AU RÉSUMÉ" : ""} :\n${chunkText}\n\n` +
          `${previous ? "Réécris le résumé en y intégrant ces échanges" : "Écris le résumé de ces échanges"}, en une courte liste à puces ` +
          `(environ ${target} tokens au maximum) : de quoi parle la conversation, les faits à retenir ` +
          `(qui, quoi, chiffres, choix faits, fichiers ou code importants), et ce qui reste à faire. Réponds uniquement par le résumé.`
      }
    ]
  },
  {
    id: "adaptatif",
    label: "Prompt de production : consignes dans la langue de la conversation",
    build: (previous, chunkText, target) => buildSummarizerMessages(previous, chunkText, target)
  },
  {
    id: "meme-langue",
    label: "Langue de la conversation, une puce = un fait, copie exacte",
    build: (previous, chunkText, target) => [
      { role: "system", content: SAME_LANGUAGE_SYSTEM },
      {
        role: "user",
        content: userBlock(previous, chunkText) +
          `${previous ? "Réécris le résumé en y intégrant ces échanges" : "Résume ces échanges"} en une liste à puces d'environ ${target} tokens au maximum. ` +
          "Couvre : le sujet, les faits et chiffres, les décisions prises, ce qui reste à faire. Réponds uniquement par la liste."
      }
    ]
  },
  {
    id: "exemple",
    label: "Idem avec un exemple de format (few-shot)",
    build: (previous, chunkText, target) => [
      { role: "system", content: SAME_LANGUAGE_SYSTEM + EXAMPLE },
      {
        role: "user",
        content: userBlock(previous, chunkText) +
          `${previous ? "Réécris le résumé en y intégrant ces échanges" : "Résume ces échanges"} en une liste à puces d'environ ${target} tokens au maximum, comme dans l'exemple. Réponds uniquement par la liste.`
      }
    ]
  },
  {
    id: "en-puces",
    label: "Instructions en anglais, même langue en sortie, copie exacte (jamais traduite)",
    build: (previous, chunkText, target) => [
      { role: "system", content: EN_SYSTEM },
      { role: "user", content: enUser(previous, chunkText, target, " as a bulleted list covering the topic, the facts and figures, the decisions made and what remains to do") }
    ]
  },
  {
    id: "en-fiche",
    label: "Instructions en anglais, rubriques Sujet / Faits / Décisions / À faire",
    build: (previous, chunkText, target) => [
      { role: "system", content: EN_SYSTEM },
      { role: "user", content: enUser(previous, chunkText, target, " with a short topic line, then bullets for the facts, the decisions and the next steps (skip empty parts)") }
    ]
  },
  {
    id: "fiche",
    label: "Fiche à rubriques (Sujet, Faits, Décisions, À faire)",
    build: (previous, chunkText, target) => [
      { role: "system", content: SAME_LANGUAGE_SYSTEM },
      {
        role: "user",
        content: userBlock(previous, chunkText) +
          `${previous ? "Réécris le résumé en y intégrant ces échanges" : "Résume ces échanges"}, environ ${target} tokens au maximum, avec ces rubriques (omets celles qui sont vides) :\n` +
          "Sujet : une phrase\nFaits : puces\nDécisions : puces\nÀ faire : puces\nRéponds uniquement par la fiche."
      }
    ]
  }
]

// ----- Exécution -----------------------------------------------------------------------------------------------

export interface SummaryTrial {
  variant: string
  caseId: string
  sample: number
  pass: boolean
  recall: number
  missing: string[]
  inventedNumbers: string[]
  checks: Record<string, boolean>
  ratio: number
  error?: string
  summary: string
}

export async function runSummaryTrial(chat: ChatFn, variant: SummaryVariant, c: SummaryCase, sample: number, model: string, seedBase: number): Promise<SummaryTrial> {
  const target = summaryTargetTokens(4096)
  const messages = variant.build(c.previous, (variant.serialize ?? serializeMessages)(c.messages), target)
  const reply = await chat({ model, messages, tools: false, temperature: 0.2, seed: seedBase + sample, numPredict: Math.round(target * 1.6), numCtx: 4096 })
  // Même traitement que l'application : les rubriques vides recopiées du modèle de consigne sont retirées
  const text = cleanSummary(reply.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim())
  // Ce que le modèle verra réellement : son résumé + les extraits fidèles des messages de l'utilisateur (voir compaction.ts)
  const notes = mergeNotes([], userNotes(c.messages), notesMaxChars(4096, 3.6))
  const summary = text ? summaryBody({ text, notes }) : ""
  const grade = gradeSummary(summary, c, text)
  const source = (c.previous ? c.previous + "\n" : "") + c.messages.map(m => m.content).join("\n")
  return {
    variant: variant.id, caseId: c.id, sample, pass: !reply.error && summary.length > 0 && Object.values(grade.checks).every(Boolean),
    recall: grade.recall, missing: grade.missing, inventedNumbers: grade.inventedNumbers, checks: grade.checks,
    ratio: summary.length / source.length, error: reply.error, summary
  }
}

export interface SummaryVariantSummary {
  id: string
  trials: number
  pass: Proportion
  recall: number
  inventedPerSummary: number
  medianRatio: number
  checkRates: Record<string, number>
}

export function summarizeSummaryTrials(trials: SummaryTrial[], variants: SummaryVariant[]): SummaryVariantSummary[] {
  return variants.map(v => {
    const mine = trials.filter(t => t.variant === v.id && !t.error)
    const names = Object.keys(mine[0]?.checks ?? {})
    const ratios = mine.map(t => t.ratio).sort((a, b) => a - b)
    return {
      id: v.id, trials: mine.length, pass: wilson(mine.filter(t => t.pass).length, mine.length),
      recall: mean(mine.map(t => t.recall)), inventedPerSummary: mean(mine.map(t => t.inventedNumbers.length)),
      medianRatio: ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0,
      checkRates: Object.fromEntries(names.map(n => [n, mine.filter(t => t.checks[n]).length / Math.max(1, mine.length)]))
    }
  })
}

export function summaryMarkdown(summaries: SummaryVariantSummary[]): string {
  const names = [...new Set(summaries.flatMap(s => Object.keys(s.checkRates)))]
  const lines = ["| Variante | Résumés réussis | Rappel des faits | Nombres inventés / résumé | Taille / source |", "|---|---|---|---|---|"]
  for (const s of summaries) lines.push(`| \`${s.id}\` | **${percent(s.pass.rate)}** [${percent(s.pass.low)}–${percent(s.pass.high)}] | ${percent(s.recall)} | ${s.inventedPerSummary.toFixed(2)} | ${percent(s.medianRatio)} |`)
  lines.push("", `| Contrôle | ${summaries.map(s => `\`${s.id}\``).join(" | ")} |`, `|---|${summaries.map(() => "---").join("|")}|`)
  for (const n of names) lines.push(`| ${n} | ${summaries.map(s => percent(s.checkRates[n] ?? 0)).join(" | ")} |`)
  return lines.join("\n")
}
