export type Category = "suivi-fichier" | "personnalisation" | "langue" | "concision" | "code" | "tableau" | "contexte" | "honnêteté" | "outil" | "outil-à-éviter"

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]   // appels d'outil rejoués (historique natif)
  tool_name?: string
}

// Message tel que l'application le mémorise (avec les fichiers créés par l'outil)
export interface ThreadMessage {
  role: "user" | "assistant"
  content: string
  files?: { id: string; name: string; lang: string; content: string }[]
}

export type HistoryStyle = "names" | "text" | "native"

export interface ToolCallResult {
  name: string
  args: Record<string, unknown>
}

export interface Reply {
  content: string
  toolCalls: ToolCallResult[]
  promptTokens: number
  outputTokens: number
  ms: number
  error?: string
}

// Ce que le correcteur sait de l'environnement de l'essai
export interface EvalEnv {
  now: Date
  model: string
}

export interface EvalCase {
  id: string
  category: Category
  lang: "fr" | "en"
  messages: ChatMessage[]      // conversation envoyée (sans le prompt système, ajouté par la variante)
  thread?: ThreadMessage[]     // conversation à plusieurs tours avec fichiers : rejouée selon le style de la variante
  tools: boolean               // l'outil create_file est-il proposé ?
  custom?: string              // instructions personnalisées de l'utilisateur pour ce cas
  // Chaque contrôle vaut vrai ou faux ; l'essai réussit si tous réussissent
  grade: (reply: Reply, env: EvalEnv) => Record<string, boolean>
  // Réponses d'exemple pour tester le correcteur lui-même
  good: Partial<Reply> & { content: string }
  bad: Partial<Reply> & { content: string }
}

export interface PromptContext {
  now: Date
  model: string
  useTools: boolean
  customInstructions?: string
}

export interface PromptVariant {
  id: string
  label: string
  build: (ctx: PromptContext) => string   // contenu du message système ('' = aucun)
  history?: HistoryStyle                  // façon de rejouer les fichiers créés dans l'historique (par défaut : celle de l'application)
  tool?: unknown                          // définition de l'outil à envoyer (par défaut : celle de l'application)
}

export interface TrialResult {
  variant: string
  caseId: string
  category: Category
  sample: number
  pass: boolean
  checks: Record<string, boolean>
  filler: boolean
  thinkLeak: boolean
  chars: number
  promptTokens: number
  outputTokens: number
  ms: number
  error?: string
  content: string
  toolCalls: ToolCallResult[]
}
