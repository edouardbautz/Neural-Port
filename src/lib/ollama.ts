// Adresse du serveur Ollama : réglable dans les Paramètres, mémorisée dans le navigateur.
// Les fonctions réseau lisent `getOllamaUrl()` à chaque appel, donc un changement d'adresse s'applique tout de suite.

export const DEFAULT_OLLAMA_URL = "http://localhost:11434"
const URL_KEY = "neural-port-ollama-url"

let current = DEFAULT_OLLAMA_URL

export function getOllamaUrl(): string {
  return current
}

export function setOllamaUrl(url: string) {
  current = url
}

// Nettoie une adresse saisie à la main : « localhost:11434 » devient « http://localhost:11434 ».
// Renvoie null si ce n'est pas une adresse http(s) valide ; une saisie vide redonne l'adresse par défaut.
export function normalizeOllamaUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return DEFAULT_OLLAMA_URL
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null
    return url.origin + url.pathname.replace(/\/+$/, "")
  } catch {
    return null
  }
}

// Lit l'adresse mémorisée et l'active (adresse par défaut si rien de valide)
export function loadSavedOllamaUrl(): string {
  try {
    const saved = normalizeOllamaUrl(localStorage.getItem(URL_KEY) ?? "")
    current = saved ?? DEFAULT_OLLAMA_URL
  } catch {
    current = DEFAULT_OLLAMA_URL
  }
  return current
}

export function saveOllamaUrl(url: string) {
  try {
    if (url === DEFAULT_OLLAMA_URL) localStorage.removeItem(URL_KEY)
    else localStorage.setItem(URL_KEY, url)
  } catch {
    // stockage indisponible : l'adresse vaut pour cette session seulement
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Appels à l'API d'Ollama
// ---------------------------------------------------------------------------------------------------------------

// Liste des modèles installés. Lève une erreur si Ollama ne répond pas ou répond mal.
export async function fetchModelNames(baseUrl: string = getOllamaUrl()): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/tags`)
  if (!response.ok) throw new Error(`Ollama a répondu ${response.status}`)
  const data = (await response.json()) as { models?: { name?: unknown }[] }
  return Array.isArray(data.models) ? data.models.map(m => m.name).filter((n): n is string => typeof n === "string") : []
}

// Le modèle est-il déjà en mémoire ? (false en cas de doute)
export async function checkModelLoaded(model: string): Promise<boolean> {
  try {
    const ps = await fetch(`${getOllamaUrl()}/api/ps`)
    const data = (await ps.json()) as { models?: { name: string }[] }
    return data.models?.some(m => m.name === model) ?? false
  } catch {
    return false
  }
}

// Capacités du modèle (Ollama refuse `tools` s'il ne le gère pas) et sa fenêtre de contexte maximale
export interface ModelInfo { tools: boolean; thinking: boolean; thinkLevels: boolean; maxCtx: number | null }

const NO_INFO: ModelInfo = { tools: false, thinking: false, thinkLevels: false, maxCtx: null }
const modelInfoCache = new Map<string, ModelInfo>()

export function clearModelInfoCache() {
  modelInfoCache.clear()
}

export async function getModelInfo(model: string): Promise<ModelInfo> {
  const key = `${getOllamaUrl()}|${model}`
  const cached = modelInfoCache.get(key)
  if (cached) return cached
  try {
    const res = await fetch(`${getOllamaUrl()}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    })
    if (!res.ok) return NO_INFO
    const data = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown>; details?: { family?: string } }
    const ctxKey = Object.keys(data.model_info ?? {}).find(k => k.endsWith(".context_length"))
    const max = ctxKey ? data.model_info?.[ctxKey] : null
    const info: ModelInfo = {
      tools: data.capabilities?.includes("tools") ?? false,
      thinking: data.capabilities?.includes("thinking") ?? false,
      // Seule la famille GPT-OSS honore les niveaux low/medium/high ; les autres n'ont qu'un on/off
      thinkLevels: /gpt-?oss/i.test(`${model} ${data.details?.family ?? ""}`),
      maxCtx: typeof max === "number" ? max : null
    }
    modelInfoCache.set(key, info)
    return info
  } catch {
    return NO_INFO
  }
}
