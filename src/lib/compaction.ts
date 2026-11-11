import type { GeneratedFile } from "./files"
import { detectLanguage } from "./language"
import { estimateTokens, MESSAGE_OVERHEAD_TOKENS, ratioFrom, type Calibration } from "./tokens"

// ---------------------------------------------------------------------------------------------------------------
// Compaction automatique de la conversation
//
// Principe : les messages d'origine ne sont jamais supprimés (ils restent affichés et conservés). La conversation
// porte un résumé « roulant » qui remplace, dans ce qui est envoyé au modèle, tous les messages d'indice < upTo.
// Quand la requête suivante risque de dépasser un seuil de la fenêtre de contexte, les messages les plus anciens
// (hors « queue » récente) sont résumés, avec l'éventuel résumé précédent, et upTo avance.
// ---------------------------------------------------------------------------------------------------------------

export interface ConversationSummary {
  text: string          // résumé rédigé par le modèle
  notes: string[]       // extraits fidèles des messages de l'utilisateur (jamais reformulés par le modèle)
  upTo: number          // le résumé remplace messages[0 .. upTo[
  messagesCovered: number
  tokensBefore: number  // taille estimée de la partie résumée (anciens messages + ancien résumé)
  tokensAfter: number   // taille estimée du résumé
  createdAt: number
  auto: boolean
}

export interface CompactionSettings {
  enabled: boolean
  threshold: number     // part de la fenêtre de contexte (0,5 à 0,9) à partir de laquelle on compacte
}

export const DEFAULT_COMPACTION: CompactionSettings = { enabled: true, threshold: 0.7 }
export const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9]

// Part de la fenêtre conservée telle quelle (messages récents) après compaction
export const KEEP_RATIO = 0.25
// Part de la fenêtre qu'un lot de messages à résumer peut occuper (le reste : consigne, résumé précédent, sortie)
export const CHUNK_RATIO = 0.45
// Taille cible d'un résumé : part de la fenêtre, bornée
export const SUMMARY_RATIO = 0.1
export const SUMMARY_MIN_TOKENS = 200
export const SUMMARY_MAX_TOKENS = 1200
// Extraits conservés mot pour mot : un petit modèle déforme les faits qu'il résume, pas ceux qu'on lui recopie
export const NOTE_MAX_CHARS = 220
export const NOTES_RATIO = 0.06
export const NOTES_MIN_TOKENS = 120

// Ce dont la compaction a besoin d'un message (sans dépendre de l'interface)
export interface Msg {
  role: "user" | "assistant"
  content: string
  files?: GeneratedFile[]
  notice?: boolean   // message d'information de l'appli, jamais envoyé au modèle
}

export function isSettings(value: unknown): value is CompactionSettings {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return typeof v.enabled === "boolean" && typeof v.threshold === "number" && v.threshold >= 0.3 && v.threshold <= 0.95
}

// Un fichier trop long est tronqué au milieu : le début et la fin suffisent à situer le contenu sans saturer la fenêtre de contexte
export const FILE_CONTEXT_MAX_CHARS = 8000
const FILE_HEAD_CHARS = 5000
const FILE_TAIL_CHARS = 2500

// Contenu d'un fichier tel que le modèle le lit : tronqué au milieu s'il est très long
function shownContent(file: GeneratedFile): string {
  const text = file.content.trimEnd()
  if (text.length <= FILE_CONTEXT_MAX_CHARS) return text
  const omitted = text.slice(FILE_HEAD_CHARS, text.length - FILE_TAIL_CHARS).split("\n").length
  return `${text.slice(0, FILE_HEAD_CHARS)}\n[… ${omitted} lines omitted …]\n${text.slice(text.length - FILE_TAIL_CHARS)}`
}

// Fichier créé, en texte : étiquette + bloc de code. Sans cela, le modèle ne sait plus ce qu'il a écrit : il ne peut ni répondre
// « que contient ce fichier ? » ni le modifier sans le réécrire de mémoire.
export function fileContext(file: GeneratedFile): string {
  const shown = shownContent(file)
  let fence = "```"
  while (shown.includes(fence)) fence += "`"
  return `[File created: ${file.name}]\n${fence}${file.lang === "text" ? "" : file.lang}\n${shown}\n${fence}`
}

// Texte d'un message tel qu'il est envoyé au modèle : le texte, puis les fichiers créés avec leur contenu.
// Un fichier dont le contenu figure déjà dans le texte (bloc de code transformé en fichier) n'est pas répété.
export function messageText(m: Msg): string {
  const parts = [m.content]
  for (const file of m.files ?? []) parts.push(m.content.includes(file.content.trim()) ? `[File created: ${file.name}]` : fileContext(file))
  return parts.filter(Boolean).join("\n\n").trim()
}

// Message tel qu'il est envoyé à Ollama
export interface ModelMessage {
  role: "user" | "assistant" | "tool"
  content: string
  tool_calls?: { function: { name: string; arguments: { filename: string; content: string } } }[]
  tool_name?: string
}

// Messages à envoyer au modèle. Avec `native` (le modèle gère les outils), un fichier créé par l'outil est rejoué comme
// l'appel qui l'a produit (tool_calls + message « tool ») : mesuré, le modèle retrouve ainsi le contenu de ses fichiers
// 92 % du temps contre 75 % quand il est ajouté au texte, et 11 % quand seul le nom est rappelé (docs/prompt-engineering.md).
// Les fichiers déjà visibles dans le texte du message (blocs de code transformés en fichiers) restent de simples étiquettes.
export function toModelMessages(thread: Msg[], native: boolean): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of thread) {
    const files = m.files ?? []
    const created = native && m.role === "assistant" ? files.filter(f => !m.content.includes(f.content.trim())) : []
    if (created.length === 0) {
      out.push({ role: m.role, content: messageText(m) })
      continue
    }
    const others = files.filter(f => !created.includes(f)).map(f => `[File created: ${f.name}]`)
    out.push({
      role: "assistant",
      content: [m.content, ...others].filter(Boolean).join("\n\n"),
      tool_calls: created.map(f => ({ function: { name: "create_file", arguments: { filename: f.name, content: shownContent(f) } } }))
    })
    for (const f of created) out.push({ role: "tool", tool_name: "create_file", content: `File created: ${f.name}` })
  }
  return out
}

export function modelMessagesChars(messages: ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0)
}

export function summaryTargetTokens(ctx: number): number {
  return Math.round(Math.min(SUMMARY_MAX_TOKENS, Math.max(SUMMARY_MIN_TOKENS, ctx * SUMMARY_RATIO)))
}

// Texte complet du résumé : rédaction du modèle puis extraits fidèles des messages de l'utilisateur
export function summaryBody(summary: Pick<ConversationSummary, "text" | "notes">): string {
  const list = summary.notes ?? [] // les résumés enregistrés avant l'ajout des extraits n'en ont pas
  const notes = list.length > 0 ? `\n\nMessages de l'utilisateur (extraits fidèles) :\n${list.map(n => `- ${n}`).join("\n")}` : ""
  return `${summary.text.trim()}${notes}`
}

// Message système qui porte le résumé dans la requête
export function summaryInjection(summary: Pick<ConversationSummary, "text" | "notes">): string {
  return (
    "Résumé de la conversation jusqu'ici (les messages d'origine ne sont plus visibles) :\n\n" +
    `${summaryBody(summary)}\n\n` +
    "Poursuis la conversation en t'appuyant sur ce résumé comme sur ta mémoire."
  )
}

// Début d'un message utilisateur sur une seule ligne, pour le conserver tel quel
function toNote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > NOTE_MAX_CHARS ? `${flat.slice(0, NOTE_MAX_CHARS - 1).trimEnd()}…` : flat
}

export function userNotes(messages: Msg[]): string[] {
  return messages.filter(m => m.role === "user" && !m.notice).map(m => toNote(m.content)).filter(Boolean)
}

// Fusionne les extraits en respectant un plafond : on sacrifie d'abord le milieu (le début pose le contexte, la fin est récente)
export function mergeNotes(previous: string[], added: string[], maxChars: number): string[] {
  const notes = [...previous, ...added]
  const size = () => notes.reduce((sum, n) => sum + n.length + 3, 0)
  while (notes.length > 2 && size() > maxChars) notes.splice(Math.floor(notes.length / 2), 1)
  return notes
}

export function notesMaxChars(ctx: number, ratio: number): number {
  return Math.round(Math.max(NOTES_MIN_TOKENS, ctx * NOTES_RATIO) * ratio)
}

// Retire du résumé les rubriques vides (« Code et fichiers : aucun ») que les petits modèles recopient du modèle de consigne
export function cleanSummary(text: string): string {
  return text
    .replace(/^[ \t*•-]*\*{0,2}[^:\n]{2,45}\*{0,2}\s*:\s*\*{0,2}\s*(aucun|aucune|néant|rien|n\/a)\b[^\n]*\n?/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Ce qui part réellement vers le modèle : les messages non résumés (hors messages d'information de l'appli)
export function visibleThread(messages: Msg[], upTo: number): Msg[] {
  return messages.slice(upTo).filter(m => !m.notice)
}

// Nombre de caractères d'une requête (même calcul pour la mesure et pour l'estimation, donc cohérent).
// `overheadChars` : ce qui s'ajoute à la conversation (prompt système, définition de l'outil)
export function requestChars(thread: Msg[], summary: Pick<ConversationSummary, "text" | "notes"> | undefined, overheadChars: number, native = false): number {
  let chars = modelMessagesChars(toModelMessages(thread, native))
  if (summary) chars += summaryInjection(summary).length
  return chars + overheadChars
}

// Taille estimée du prochain prompt. Avec une mesure réelle précédente, on ne corrige que l'écart de contenu ;
// sinon on estime tout à partir du nombre de caractères.
export function estimatePromptTokens(chars: number, messageCount: number, calibration: Calibration | undefined): number {
  const ratio = ratioFrom(calibration)
  if (calibration && calibration.tokens > 0) {
    return Math.max(0, Math.round(calibration.tokens + (chars - calibration.chars) / ratio))
  }
  return estimateTokens(chars, ratio) + messageCount * MESSAGE_OVERHEAD_TOKENS
}

export function shouldCompact(estimatedTokens: number, ctx: number, threshold: number): boolean {
  return estimatedTokens > ctx * threshold
}

export function messageTokens(m: Msg, ratio: number): number {
  return estimateTokens(messageText(m).length, ratio) + MESSAGE_OVERHEAD_TOKENS
}

export interface CompactionPlan {
  cut: number             // nouvel upTo : les messages [from, cut[ sont résumés
  head: Msg[]             // messages à résumer (déjà privés des messages d'information)
  tailTokens: number
}

// Choisit où couper. La queue conservée commence toujours par un message utilisateur (on ne sépare jamais une
// question de sa réponse), contient au moins le dernier message utilisateur, et tient dans `ctx × KEEP_RATIO` quand
// c'est possible.
export function planCompaction(messages: Msg[], from: number, ctx: number, ratio: number): CompactionPlan | null {
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUser = i; break }
  }
  if (lastUser <= from) return null // rien d'antérieur au dernier message utilisateur à résumer

  const budget = ctx * KEEP_RATIO
  let cut = lastUser
  let tail = 0
  for (let i = messages.length - 1; i >= from; i--) {
    if (!messages[i].notice) tail += messageTokens(messages[i], ratio)
    if (messages[i].role === "user" && i < lastUser) {
      if (tail <= budget) cut = i
      else break
    }
  }
  const head = messages.slice(from, cut).filter(m => !m.notice)
  if (head.length === 0) return null

  let tailTokens = 0
  for (let i = cut; i < messages.length; i++) if (!messages[i].notice) tailTokens += messageTokens(messages[i], ratio)
  return { cut, head, tailTokens }
}

// Découpe les messages à résumer en lots qui tiennent dans la fenêtre (un message trop gros est tronqué au milieu)
export function splitChunks(messages: Msg[], chunkTokens: number, ratio: number): Msg[][] {
  const maxChars = Math.max(500, Math.floor(chunkTokens * ratio))
  const chunks: Msg[][] = []
  let current: Msg[] = []
  let size = 0
  for (const original of messages) {
    const m = shrinkMessage(original, maxChars)
    const chars = messageText(m).length + 20
    if (current.length > 0 && size + chars > maxChars) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(m)
    size += chars
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function shrinkMessage(m: Msg, maxChars: number): Msg {
  const text = messageText(m)
  if (text.length <= maxChars) return m
  const keep = Math.floor((maxChars - 40) / 2)
  return { ...m, files: undefined, content: `${text.slice(0, keep)}\n[… passage tronqué …]\n${text.slice(-keep)}` }
}

// Les étiquettes de rôle suivent la langue de la conversation : « UTILISATEUR : » dans une conversation anglaise
// poussait le modèle à répondre en français (mesuré)
export function serializeMessages(messages: Msg[]): string {
  const english = detectLanguage(messages.map(messageText).join("\n")) === "en"
  const labels = english ? { user: "USER", assistant: "ASSISTANT", sep: ":" } : { user: "UTILISATEUR", assistant: "ASSISTANT", sep: " :" }
  return messages
    .map(m => `${m.role === "user" ? labels.user : labels.assistant}${labels.sep}\n${messageText(m)}`)
    .join("\n\n---\n\n")
}

const SUMMARIZER_SYSTEM_FR =
  "Tu résumes des conversations pour qu'elles tiennent dans une mémoire limitée. " +
  "Tu écris en français, de façon factuelle et dense. Tu recopies exactement les noms, nombres, dates et noms de fichiers. " +
  "Tu n'inventes rien : une information absente des échanges ne doit pas apparaître. Tu ne commentes jamais ta tâche."

const SUMMARIZER_SYSTEM_EN =
  "You summarize conversations so they fit in a limited memory. Write the summary in English, factual and dense. " +
  "Each bullet holds one precise fact. Copy names, numbers, dates, file names, identifiers and code snippets exactly as written: never translate or change them. " +
  "Add nothing that is not in the conversation. Do not comment on your task."

// Chez un petit modèle, la langue des consignes dicte celle du résumé (mesuré : consignes françaises sur une conversation
// anglaise donnent un résumé français aux dates traduites, et inversement). On écrit donc les consignes dans la langue de la conversation.
export function buildSummarizerMessages(previous: string | undefined, chunkText: string, targetTokens: number) {
  const english = detectLanguage(`${previous ?? ""}\n${chunkText}`) === "en"
  const user = english
    ? (previous ? `CURRENT SUMMARY:\n${previous.trim()}\n\n` : "") +
      `CONVERSATION${previous ? " TO ADD TO THE SUMMARY" : ""}:\n${chunkText}\n\n` +
      `${previous ? "Rewrite the summary to include this conversation" : "Summarize this conversation"} as a bulleted list (about ${targetTokens} tokens at most) ` +
      "covering the topic, the facts and figures, the decisions made and what remains to do. Reply with the summary only."
    : (previous ? `RÉSUMÉ ACTUEL :\n${previous.trim()}\n\n` : "") +
      `ÉCHANGES${previous ? " À AJOUTER AU RÉSUMÉ" : ""} :\n${chunkText}\n\n` +
      `${previous ? "Réécris le résumé en y intégrant ces échanges" : "Écris le résumé de ces échanges"}, en une courte liste à puces ` +
      `(environ ${targetTokens} tokens au maximum) : de quoi parle la conversation, les faits à retenir ` +
      `(qui, quoi, chiffres, choix faits, fichiers ou code importants), et ce qui reste à faire. ` +
      "Réponds uniquement par le résumé."
  return [
    { role: "system" as const, content: english ? SUMMARIZER_SYSTEM_EN : SUMMARIZER_SYSTEM_FR },
    { role: "user" as const, content: user }
  ]
}

export type Summarizer = (previous: string | undefined, chunkText: string, targetTokens: number) => Promise<string>

export interface CompactionInput {
  messages: Msg[]
  previous: ConversationSummary | undefined
  ctx: number
  ratio: number
  auto: boolean
  summarize: Summarizer
  onProgress?: (done: number, total: number) => void
}

export type CompactionResult =
  | { ok: true; summary: ConversationSummary }
  | { ok: false; reason: "nothing" | "invalid" }

// Résumé roulant : chaque lot est fusionné au résumé courant. Vérifie que le résultat est utilisable et plus court.
export async function compactConversation(input: CompactionInput): Promise<CompactionResult> {
  const { messages, previous, ctx, ratio } = input
  const from = previous?.upTo ?? 0
  const plan = planCompaction(messages, from, ctx, ratio)
  if (!plan) return { ok: false, reason: "nothing" }

  const target = summaryTargetTokens(ctx)
  const chunks = splitChunks(plan.head, ctx * CHUNK_RATIO, ratio)
  const sourceTokens =
    plan.head.reduce((sum, m) => sum + messageTokens(m, ratio), 0) + (previous ? estimateTokens(previous.text.length, ratio) : 0)

  let running = previous?.text
  for (let i = 0; i < chunks.length; i++) {
    input.onProgress?.(i, chunks.length)
    const text = cleanSummary(await input.summarize(running, serializeMessages(chunks[i]), target))
    if (!text) return { ok: false, reason: "invalid" }
    running = text
  }
  input.onProgress?.(chunks.length, chunks.length)

  const notes = mergeNotes(previous?.notes ?? [], userNotes(plan.head), notesMaxChars(ctx, ratio))
  const tokensAfter = estimateTokens(summaryBody({ text: running!, notes }).length, ratio)
  // Un résumé aussi long que ce qu'il remplace ne sert à rien
  if (tokensAfter >= sourceTokens * 0.8) return { ok: false, reason: "invalid" }

  return {
    ok: true,
    summary: {
      text: running!,
      notes,
      upTo: plan.cut,
      messagesCovered: messages.slice(0, plan.cut).filter(m => !m.notice).length,
      tokensBefore: sourceTokens,
      tokensAfter,
      createdAt: Date.now(),
      auto: input.auto
    }
  }
}
