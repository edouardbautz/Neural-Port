// ---------------------------------------------------------------------------------------------------------------
// Lecture du flux de /api/chat d'Ollama : une ligne JSON par fragment (NDJSON).
// Fonctions pures, testées à part : l'interface n'a plus qu'à appliquer leurs résultats.
// ---------------------------------------------------------------------------------------------------------------

export interface ToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> }
}

export interface ChatChunk {
  message?: {
    content?: string
    thinking?: string
    tool_calls?: ToolCall[]
  }
  error?: string
  done?: boolean
  eval_count?: number
  prompt_eval_count?: number
  eval_duration?: number
}

// Découpe le texte reçu en lignes complètes. La fin de ligne incomplète est gardée pour la lecture suivante
// (un gros appel d'outil peut être coupé entre deux lectures) ; à la fin du flux, elle est traitée aussi.
export function splitStreamLines(carry: string, text: string, done: boolean): { lines: string[]; carry: string } {
  const parts = (carry + text).split("\n")
  const rest = done ? "" : (parts.pop() ?? "")
  return { lines: parts.filter(line => line.trim()), carry: rest }
}

// Une ligne illisible ou qui n'est pas un objet est ignorée (null), jamais fatale
export function parseChatChunk(line: string): ChatChunk | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === "object" && !Array.isArray(value) ? (value as ChatChunk) : null
  } catch {
    return null
  }
}

// Fichiers demandés par le modèle via l'outil create_file ; tout ce qui est mal formé est ignoré
export function toolFiles(calls: ToolCall[] | undefined): { filename: string; content: string }[] {
  const files: { filename: string; content: string }[] = []
  for (const call of calls ?? []) {
    const { filename, content } = call?.function?.arguments ?? {}
    if (call?.function?.name !== "create_file") continue
    if (typeof filename !== "string" || typeof content !== "string" || !filename.trim() || !content.trim()) continue
    files.push({ filename, content })
  }
  return files
}

// Certains modèles écrivent leur réflexion entre <think> et </think> dans le texte de la réponse
export interface ThinkTagState {
  openIdx: number   // position de <think> (-1 tant qu'il n'est pas apparu)
  closeIdx: number  // position de </think> (-1 tant qu'il n'est pas apparu)
}

export const NO_THINK_TAGS: ThinkTagState = { openIdx: -1, closeIdx: -1 }

// Texte à afficher (sans la réflexion) pour la réponse brute reçue jusqu'ici ; `inTag` : la réflexion est en cours
export function splitThinkTags(raw: string, state: ThinkTagState): { display: string; inTag: boolean; state: ThinkTagState } {
  let { openIdx, closeIdx } = state
  if (openIdx === -1) openIdx = raw.indexOf("<think>")
  if (openIdx !== -1 && closeIdx === -1) closeIdx = raw.indexOf("</think>")
  const before = openIdx > 0 ? raw.slice(0, openIdx) : ""
  const next = { openIdx, closeIdx }
  if (openIdx === -1) return { display: raw, inTag: false, state: next }
  if (closeIdx === -1) return { display: before, inTag: true, state: next }
  return { display: before + raw.slice(closeIdx + "</think>".length).trimStart(), inTag: false, state: next }
}

export interface FinalStats {
  ctxUsed: number                 // tokens de contexte utilisés (prompt + génération)
  promptTokens: number | null     // mesure réelle du prompt, si Ollama l'a fournie
  tokens: number | null           // tokens générés (réflexion interrompue comprise)
  seconds: number                 // durée de génération (idem)
}

// Valeurs réelles de la fin du flux. Rien n'est inventé : sans mesure, on renvoie null.
export function finalStats(chunk: ChatChunk, carriedTokens: number, carriedSec: number): FinalStats {
  return {
    ctxUsed: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
    promptTokens: chunk.prompt_eval_count && chunk.prompt_eval_count > 0 ? chunk.prompt_eval_count : null,
    tokens: chunk.eval_count ? chunk.eval_count + carriedTokens : null,
    seconds: (chunk.eval_duration ?? 0) / 1e9 + carriedSec
  }
}
