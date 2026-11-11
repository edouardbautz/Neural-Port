import type { Conversation, Message } from "../App"
import type { ConversationSummary } from "./compaction"
import type { GeneratedFile } from "./files"

// ---------------------------------------------------------------------------------------------------------------
// Historique : lecture tolérante (on répare au lieu de jeter), export et import
// ---------------------------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

function cleanFiles(value: unknown): GeneratedFile[] | undefined {
  if (!Array.isArray(value)) return undefined
  const files = value.filter(
    (f): f is GeneratedFile => isObject(f) && typeof f.id === "string" && typeof f.name === "string" && typeof f.lang === "string" && typeof f.content === "string"
  ).map(f => ({ id: f.id, name: f.name, lang: f.lang, content: f.content }))
  return files.length > 0 ? files : undefined
}

// Un message valide a un rôle et un texte ; les champs optionnels mal typés sont simplement ignorés
function cleanMessage(value: unknown): Message | null {
  if (!isObject(value)) return null
  if ((value.role !== "user" && value.role !== "assistant") || typeof value.content !== "string") return null
  const m: Message = { role: value.role, content: value.content }
  if (isNum(value.tps)) m.tps = value.tps
  if (isNum(value.duration)) m.duration = value.duration
  if (isNum(value.tokens)) m.tokens = value.tokens
  if (isNum(value.ctxUsed)) m.ctxUsed = value.ctxUsed
  if (value.notice === true) m.notice = true
  if (value.approx === true) m.approx = true
  if (typeof value.thinking === "string") m.thinking = value.thinking
  const files = cleanFiles(value.files)
  if (files) m.files = files
  return m
}

function cleanSummary(value: unknown, messageCount: number): ConversationSummary | undefined {
  if (!isObject(value) || typeof value.text !== "string") return undefined
  // Le résumé doit laisser au moins le dernier message hors de sa portée
  if (!isNum(value.upTo) || !Number.isInteger(value.upTo) || value.upTo < 0 || value.upTo > messageCount - 1) return undefined
  const notes = Array.isArray(value.notes) ? value.notes.filter((n): n is string => typeof n === "string") : []
  return {
    text: value.text,
    notes,
    upTo: value.upTo,
    messagesCovered: isNum(value.messagesCovered) ? value.messagesCovered : value.upTo,
    tokensBefore: isNum(value.tokensBefore) ? value.tokensBefore : 0,
    tokensAfter: isNum(value.tokensAfter) ? value.tokensAfter : 0,
    createdAt: isNum(value.createdAt) ? value.createdAt : 0,
    auto: value.auto === true
  }
}

function cleanConversation(value: unknown): { conversation: Conversation; repaired: boolean } | null {
  if (!isObject(value) || typeof value.id !== "string" || !value.id || !Array.isArray(value.messages)) return null
  const messages = value.messages.map(cleanMessage).filter((m): m is Message => m !== null)
  const dropped = messages.length !== value.messages.length
  // Si un message a été écarté, les indices d'un résumé ne correspondent plus : on l'écarte aussi
  const summary = dropped ? undefined : cleanSummary(value.summary, messages.length)
  const updatedAt = isNum(value.updatedAt) ? value.updatedAt : isNum(value.createdAt) ? value.createdAt : 0
  const conversation: Conversation = {
    id: value.id,
    title: typeof value.title === "string" && value.title.trim() ? value.title : "Conversation sans titre",
    messages,
    createdAt: isNum(value.createdAt) ? value.createdAt : updatedAt,
    updatedAt
  }
  if (typeof value.model === "string") conversation.model = value.model
  if (summary) conversation.summary = summary
  if (isObject(value.calib) && isNum(value.calib.tokens) && isNum(value.calib.chars)) {
    conversation.calib = { tokens: value.calib.tokens, chars: value.calib.chars }
  }
  return { conversation, repaired: dropped || (value.summary !== undefined && !summary) }
}

export interface SanitizeResult {
  conversations: Conversation[]
  repaired: number  // conversations dont des éléments invalides ont été retirés
  skipped: number   // éléments inutilisables, écartés en entier
}

// Garde tout ce qui est récupérable. Les identifiants en double sont ignorés (le premier l'emporte).
export function sanitizeConversations(value: unknown): SanitizeResult {
  const result: SanitizeResult = { conversations: [], repaired: 0, skipped: 0 }
  if (!Array.isArray(value)) return result
  const seen = new Set<string>()
  for (const item of value) {
    const cleaned = cleanConversation(item)
    if (!cleaned || seen.has(cleaned.conversation.id)) {
      result.skipped++
      continue
    }
    seen.add(cleaned.conversation.id)
    result.conversations.push(cleaned.conversation)
    if (cleaned.repaired) result.repaired++
  }
  return result
}

// ----- Export / import ------------------------------------------------------------------------------------------

const EXPORT_APP = "neural-port"
const EXPORT_VERSION = 1

export function exportHistory(conversations: Conversation[]): string {
  return JSON.stringify({ app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), conversations }, null, 2)
}

export function exportFilename(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `neural-port-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

export type ImportParse = { ok: true; result: SanitizeResult } | { ok: false; error: string }

// Accepte un export de Neural-Port, ou directement une liste de conversations
export function parseImport(text: string): ImportParse {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: "Ce fichier n'est pas un JSON valide." }
  }
  const list = isObject(data) && data.app === EXPORT_APP ? data.conversations : data
  if (!Array.isArray(list)) return { ok: false, error: "Ce fichier ne ressemble pas à un export de Neural-Port." }
  const result = sanitizeConversations(list)
  if (result.conversations.length === 0) {
    return { ok: false, error: list.length === 0 ? "Ce fichier ne contient aucune conversation." : "Aucune conversation exploitable dans ce fichier." }
  }
  return { ok: true, result }
}

// Ajoute les conversations importées ; celles dont l'identifiant existe déjà ne sont pas dupliquées
export function mergeConversations(existing: Conversation[], imported: Conversation[]): { merged: Conversation[]; added: number } {
  const ids = new Set(existing.map(c => c.id))
  const fresh = imported.filter(c => !ids.has(c.id))
  return { merged: [...existing, ...fresh], added: fresh.length }
}
