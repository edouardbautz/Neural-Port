import { CREATE_FILE_TOOL } from "../lib/prompts"
import { leaksThinkTags, startsWithFiller } from "./graders"
import type { ChatMessage, EvalCase, EvalEnv, PromptVariant, Reply, TrialResult } from "./types"

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools: boolean
  tool?: unknown
  temperature: number   // NaN : on n'envoie pas de température, le modèle utilise sa valeur par défaut (comme l'application)
  seed: number
  numPredict: number
  numCtx: number
}

export type ChatFn = (request: ChatRequest) => Promise<Reply>

// Appel réel à Ollama (non streamé : on mesure la réponse complète)
export function ollamaChat(baseUrl: string, options: { thinkOff: boolean }): ChatFn {
  return async request => {
    const started = Date.now()
    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          ...(request.tools ? { tools: [request.tool ?? CREATE_FILE_TOOL] } : {}),
          stream: false,
          ...(options.thinkOff ? { think: false } : {}),
          options: { ...(Number.isFinite(request.temperature) ? { temperature: request.temperature } : {}), seed: request.seed, num_predict: request.numPredict, num_ctx: request.numCtx }
        })
      })
      const data = (await response.json()) as {
        message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: Record<string, unknown> } }[] }
        prompt_eval_count?: number
        eval_count?: number
        error?: string
      }
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
      return {
        content: data.message?.content ?? "",
        toolCalls: (data.message?.tool_calls ?? []).map(c => ({ name: c.function?.name ?? "", args: c.function?.arguments ?? {} })),
        promptTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        ms: Date.now() - started
      }
    } catch (error) {
      return { content: "", toolCalls: [], promptTokens: 0, outputTokens: 0, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export interface RunOptions {
  model: string
  temperature: number
  seedBase: number
  numPredict: number
  numCtx: number
}

export async function runTrial(chat: ChatFn, variant: PromptVariant, testCase: EvalCase, sample: number, env: EvalEnv, options: RunOptions): Promise<TrialResult> {
  const system = variant.build({ now: env.now, model: env.model, useTools: testCase.tools })
  const messages: ChatMessage[] = system ? [{ role: "system", content: system }, ...testCase.messages] : testCase.messages
  const reply: Reply = await chat({
    model: options.model, messages, tools: testCase.tools, tool: variant.tool, temperature: options.temperature,
    seed: options.seedBase + sample, numPredict: options.numPredict, numCtx: options.numCtx
  })
  // Une erreur d'appel n'est pas un échec du prompt : le rapport la compte à part
  const checks = reply.error ? {} : testCase.grade(reply, env)
  return {
    variant: variant.id, caseId: testCase.id, category: testCase.category, sample,
    pass: !reply.error && Object.values(checks).every(Boolean),
    checks, filler: startsWithFiller(reply.content), thinkLeak: leaksThinkTags(reply.content),
    chars: reply.content.length, promptTokens: reply.promptTokens, outputTokens: reply.outputTokens, ms: reply.ms,
    error: reply.error, content: reply.content, toolCalls: reply.toolCalls
  }
}

export async function runAll(
  chat: ChatFn, variants: PromptVariant[], cases: EvalCase[], samples: number, env: EvalEnv, options: RunOptions,
  onTrial?: (trial: TrialResult, done: number, total: number) => void
): Promise<TrialResult[]> {
  const results: TrialResult[] = []
  const total = variants.length * cases.length * samples
  // Un essai de chaque cas avant de passer à l'échantillon suivant : un arrêt prématuré reste exploitable
  for (let sample = 0; sample < samples; sample++) {
    for (const testCase of cases) {
      for (const variant of variants) {
        const trial = await runTrial(chat, variant, testCase, sample, env, options)
        results.push(trial)
        onTrial?.(trial, results.length, total)
      }
    }
  }
  return results
}
