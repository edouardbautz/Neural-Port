import { buildSummarizerMessages, type Summarizer } from "./compaction"

// Fabrique le résumeur qui interroge Ollama. Même `num_ctx` que le chat (sinon Ollama recharge le modèle),
// température basse, sans réflexion pour les modèles qui savent raisonner.
export function makeOllamaSummarizer(opts: {
  baseUrl: string
  model: string
  numCtx: number
  canThink: boolean
  signal?: AbortSignal
}): Summarizer {
  return async (previous, chunkText, targetTokens) => {
    const res = await fetch(`${opts.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: buildSummarizerMessages(previous, chunkText, targetTokens),
        stream: false,
        options: { num_ctx: opts.numCtx, temperature: 0.2, num_predict: Math.round(targetTokens * 1.6) },
        ...(opts.canThink ? { think: false } : {})
      }),
      signal: opts.signal
    })
    const data = (await res.json()) as { message?: { content?: string }; error?: string }
    if (!res.ok || data.error) throw new Error(data.error ?? `Ollama a répondu ${res.status}`)
    // Certains modèles laissent une balise de réflexion dans le contenu
    return (data.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()
  }
}
