import { messageText } from "../lib/compaction"
import type { ChatMessage, HistoryStyle, ThreadMessage } from "./types"

// Rejoue une conversation avec fichiers selon trois styles, pour mesurer lequel permet au modèle de retrouver ce qu'il a écrit.
export function renderThread(thread: ThreadMessage[], style: HistoryStyle): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of thread) {
    if (m.role === "user" || !m.files?.length) {
      out.push({ role: m.role, content: m.content })
      continue
    }
    if (style === "names") {
      // Comportement d'origine : seuls les noms des fichiers sont rappelés
      out.push({ role: "assistant", content: `${m.content}\n[Fichiers créés : ${m.files.map(f => f.name).join(", ")}]`.trim() })
    } else if (style === "text") {
      out.push({ role: "assistant", content: messageText(m) })
    } else {
      out.push({ role: "assistant", content: m.content, tool_calls: m.files.map(f => ({ function: { name: "create_file", arguments: { filename: f.name, content: f.content } } })) })
      for (const f of m.files) out.push({ role: "tool", tool_name: "create_file", content: `File created: ${f.name}` })
    }
  }
  return out
}
