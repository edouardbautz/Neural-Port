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
