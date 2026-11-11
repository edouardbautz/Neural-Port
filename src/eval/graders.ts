// ---------------------------------------------------------------------------------------------------------------
// Correcteurs déterministes des réponses du modèle.
// Volontairement sans « modèle juge » : un petit modèle local est un mauvais juge, et un correcteur en code est
// reproductible, gratuit et lui-même testable (voir graders.test.ts).
// ---------------------------------------------------------------------------------------------------------------

import { detectLanguage, words, type Language } from "../lib/language"

export { detectLanguage, type Language }

// La réponse est-elle dans la langue attendue ? Un texte très court (« Today is Wednesday. ») n'a pas assez de mots
// courants pour être classé : on l'accepte tant qu'il n'est pas détectable dans l'autre langue.
export function languageMatches(text: string, expected: "fr" | "en"): boolean {
  const detected = detectLanguage(text)
  if (detected === expected) return true
  return detected === "unknown" && words(text).length <= 12
}

export interface FenceReport {
  blocks: number          // blocs de code ouverts
  unclosed: boolean       // un bloc est resté ouvert à la fin
  untagged: number        // blocs sans nom de langage
  languages: string[]
  codeChars: number
}

// Analyse des blocs de code Markdown, avec la même règle que l'application : une fermeture n'a jamais de langage
export function fenceReport(markdown: string): FenceReport {
  const report: FenceReport = { blocks: 0, unclosed: false, untagged: 0, languages: [], codeChars: 0 }
  let open: { char: string; len: number } | null = null
  for (const line of markdown.split("\n")) {
    const m = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line)
    if (m) {
      const info = m[2].trim()
      if (!open) {
        open = { char: m[1][0], len: m[1].length }
        report.blocks++
        if (info) report.languages.push(info.split(/\s+/)[0].toLowerCase())
        else report.untagged++
        continue
      }
      if (m[1][0] === open.char && m[1].length >= open.len && info === "") {
        open = null
        continue
      }
    }
    if (open) report.codeChars += line.length + 1
  }
  report.unclosed = open !== null
  return report
}

export function countBullets(markdown: string): number {
  return markdown.split("\n").filter(line => /^\s*([-*•]|\d+[.)])\s+\S/.test(line)).length
}

export function countSentences(text: string): number {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, "x").replace(/\d+[.,]\d+/g, "0")
  return plain.split(/[.!?…]+(?:\s|$)/).filter(part => words(part).length >= 2).length
}

// Tableau Markdown valide : en-tête, ligne de séparation, au moins 2 lignes de données, même nombre de colonnes
export function hasValidTable(markdown: string, minRows = 2): boolean {
  const lines = markdown.split("\n").map(l => l.trim()).filter(l => l.startsWith("|") && l.endsWith("|"))
  const sep = lines.findIndex(l => /^\|[\s:|-]+\|$/.test(l) && l.includes("-"))
  if (sep < 1) return false
  const cols = (l: string) => l.slice(1, -1).split("|").length
  const width = cols(lines[sep])
  const rows = lines.slice(sep + 1).filter(l => cols(l) === width)
  return cols(lines[sep - 1]) === width && rows.length >= minRows
}

const HEDGE = [
  "je ne connais pas", "je ne connais aucun", "je n'ai pas d'information", "je n'ai aucune information", "je n'ai pas connaissance",
  "je ne dispose pas", "je ne suis pas sûr", "je ne suis pas certain", "je ne peux pas confirmer", "je ne trouve pas", "n'existe pas",
  "pas accès", "n'ai pas accès", "pas connecté", "pas d'accès", "hors ligne", "pas de trace", "aucune information", "aucune trace", "je ne sais pas", "inconnu", "fictif", "imaginaire", "pas en mesure", "je ne peux pas",
  "no access", "not connected", "don't have access", "do not have access", "offline", "i don't know", "i do not know", "i'm not aware", "i am not aware", "i don't have", "i do not have", "no information", "not familiar",
  "does not exist", "doesn't exist", "i'm not sure", "i am not sure", "cannot verify", "can't verify", "fictional", "unable to", "i cannot", "i can't"
]

// La réponse reconnaît-elle une limite (ignorance, doute, impossibilité) ?
export function hedges(text: string): boolean {
  const t = text.toLowerCase().replace(/[’]/g, "'")
  return HEDGE.some(h => t.includes(h))
}

const FILLER = /^\s*(?:\*\*)?(bien sûr|certainement|absolument|avec plaisir|excellente question|très bonne question|bonne question|volontiers|of course|certainly|sure|absolutely|great question|good question|happy to help|i'd be happy|i would be happy)\b/i

// Formule d'introduction creuse en début de réponse
export function startsWithFiller(text: string): boolean {
  return FILLER.test(text.replace(/^[\s"«]+/, ""))
}

export function leaksThinkTags(text: string): boolean {
  return /<\/?think>/i.test(text)
}

export function includesAll(text: string, needles: string[]): boolean {
  const t = text.toLowerCase()
  return needles.every(n => t.includes(n.toLowerCase()))
}

export function includesAny(text: string, needles: string[]): boolean {
  const t = text.toLowerCase()
  return needles.some(n => t.includes(n.toLowerCase()))
}

// Dates attendues dans une réponse (plusieurs écritures acceptées)
export function dateForms(date: Date): { fr: string[]; en: string[] } {
  const d = date.getDate()
  const y = date.getFullYear()
  const month = (locale: string) => date.toLocaleDateString(locale, { month: "long" })
  const pad = (n: number) => String(n).padStart(2, "0")
  const mm = pad(date.getMonth() + 1)
  const common = [`${pad(d)}/${mm}/${y}`, `${d}/${date.getMonth() + 1}/${y}`, `${y}-${mm}-${pad(d)}`, `${pad(d)}.${mm}.${y}`]
  return {
    fr: [`${d} ${month("fr-FR")} ${y}`, `${d}${d === 1 ? "er" : ""} ${month("fr-FR")} ${y}`, ...common],
    en: [`${month("en-US")} ${d}, ${y}`, `${month("en-US")} ${d}`, `${d} ${month("en-US")} ${y}`, `${d}th ${month("en-US")}`, `${d}st ${month("en-US")}`, `${d}nd ${month("en-US")}`, `${d}rd ${month("en-US")}`, ...common]
  }
}
