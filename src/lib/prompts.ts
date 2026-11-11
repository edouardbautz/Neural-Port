// ---------------------------------------------------------------------------------------------------------------
// Prompts envoyés au modèle : définition de l'outil de fichiers et éléments communs.
// ---------------------------------------------------------------------------------------------------------------

// Définition de l'outil : elle fait partie du prompt (le modèle la lit). Mesuré : la langue et la longueur de sa description
// n'ont pas d'effet significatif sur l'usage de l'outil ; la version courte économise de la fenêtre de contexte.
export const CREATE_FILE_TOOL = {
  type: "function",
  function: {
    name: "create_file",
    description: "Create a file for the user to download.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "e.g. main.py" },
        content: { type: "string" }
      },
      required: ["filename", "content"]
    }
  }
}

// Date et heure telles que le modèle doit les lire : « mercredi 11 novembre 2026, 14:32 (Europe/Paris) »
export function formatNow(date: Date, locale = "fr-FR"): string {
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
  let zone = ""
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    // fuseau inconnu : on l'omet
  }
  return `${day}, ${time}${zone ? ` (${zone})` : ""}`
}

// Date seule : « mercredi 11 novembre 2026 (Europe/Paris) ». Sans l'heure, le texte reste identique toute la journée,
// ce qui préserve le cache de préfixe d'Ollama (mesuré : 4× plus rapide à retraiter une longue conversation).
export function formatDay(date: Date, locale = "fr-FR"): string {
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)
  let zone = ""
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    // fuseau inconnu : on l'omet
  }
  return `${day}${zone ? ` (${zone})` : ""}`
}

export interface PromptContext {
  now: Date
  model?: string
  useTools: boolean
  customInstructions?: string   // instructions de l'utilisateur (déjà normalisées)
}

// Taille de la définition de l'outil quand elle est envoyée avec la requête
export const TOOL_DEFINITION_CHARS = JSON.stringify(CREATE_FILE_TOOL).length

// Prompt système : quatre lignes, rédigées en anglais, choisies par évaluation (voir docs/prompt-engineering.md).
//  - En anglais, avec « Reply in the user's language » : un prompt système en français faisait répondre en français
//    à des questions en anglais (langue respectée : 50 % contre 100 %).
//  - Court : chaque règle ajoutée a fait baisser le respect du code ou des outils, sans améliorer l'honnêteté.
//  - Date sans heure : le texte reste identique toute la journée, ce qui préserve le cache de préfixe d'Ollama
//    (mesuré : une longue conversation est retraitée 4× plus vite).
export function buildSystemPrompt(ctx: PromptContext): string {
  return [
    `You are a local AI assistant${ctx.model ? ` (model ${ctx.model}, running through Ollama)` : " (running through Ollama)"} with no Internet access. Today is ${formatDay(ctx.now, "en-US")}.`,
    "Reply in the user's language. Be concise and direct. If you don't know, say so: never make things up.",
    "Put code in ``` blocks tagged with the language name.",
    ...(ctx.useTools ? ["Use the create_file tool only when the user asks for a file."] : []),
    ...customBlock(ctx.customInstructions)
  ].join("\n")
}

// Instructions de l'utilisateur : placées en dernier, sous un intitulé neutre. Mesuré sur 7 cas (5 essais, température 0,4) :
// suivies 57 % du temps contre 11 % si elles sont ignorées ; la même consigne présentée comme « prioritaire » (46 %), placée
// au début (57 %) ou avec une règle de langue assouplie (43 %) ne fait pas mieux : le texte le plus simple est retenu.
export function customBlock(instructions: string | undefined): string[] {
  const text = instructions?.trim()
  return text ? ["", "Additional instructions:", text] : []
}
