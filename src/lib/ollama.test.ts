import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkModelLoaded, clearModelInfoCache, DEFAULT_OLLAMA_URL, fetchModelNames, getModelInfo, normalizeOllamaUrl, setOllamaUrl } from "./ollama"

describe("normalizeOllamaUrl", () => {
  it("ajoute http:// et retire le slash final", () => {
    expect(normalizeOllamaUrl("localhost:11434")).toBe("http://localhost:11434")
    expect(normalizeOllamaUrl(" http://192.168.1.5:11434/ ")).toBe("http://192.168.1.5:11434")
    expect(normalizeOllamaUrl("https://exemple.fr/ollama/")).toBe("https://exemple.fr/ollama")
  })
  it("ignore paramètres et ancre", () => {
    expect(normalizeOllamaUrl("http://h:1/?a=1#x")).toBe("http://h:1")
  })
  it("saisie vide : adresse par défaut", () => {
    expect(normalizeOllamaUrl("  ")).toBe(DEFAULT_OLLAMA_URL)
  })
  it("refuse ce qui n'est pas http(s)", () => {
    expect(normalizeOllamaUrl("ftp://h")).toBeNull()
    expect(normalizeOllamaUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeOllamaUrl("http://")).toBeNull()
  })
})

describe("client Ollama", () => {
  const json = (body: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
  beforeEach(() => {
    clearModelInfoCache()
    setOllamaUrl("http://h:1")
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setOllamaUrl(DEFAULT_OLLAMA_URL)
  })

  it("liste les modèles et ignore les entrées sans nom", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ models: [{ name: "a:1b" }, { name: 3 }, {}, { name: "b" }] })))
    expect(await fetchModelNames()).toEqual(["a:1b", "b"])
    expect(fetch).toHaveBeenCalledWith("http://h:1/api/tags")
  })
  it("liste vide si la réponse n'a pas de modèles", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({})))
    expect(await fetchModelNames()).toEqual([])
  })
  it("lève une erreur si Ollama répond en erreur ou ne répond pas", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({}, false, 500)))
    await expect(fetchModelNames()).rejects.toThrow("500")
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))))
    await expect(fetchModelNames()).rejects.toThrow("Failed to fetch")
  })

  it("détecte un modèle déjà chargé, et répond false au moindre doute", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ models: [{ name: "a" }] })))
    expect(await checkModelLoaded("a")).toBe(true)
    expect(await checkModelLoaded("b")).toBe(false)
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau"))))
    expect(await checkModelLoaded("a")).toBe(false)
  })

  it("lit les capacités du modèle et les met en cache", async () => {
    const fetchMock = vi.fn(() => json({ capabilities: ["completion", "tools", "thinking"], model_info: { "llama.context_length": 131072 }, details: { family: "llama" } }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await getModelInfo("m")).toEqual({ tools: true, thinking: true, thinkLevels: false, maxCtx: 131072 })
    await getModelInfo("m")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("reconnaît GPT-OSS pour les niveaux de réflexion", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ capabilities: ["thinking"], details: { family: "gptoss" } })))
    expect((await getModelInfo("gpt-oss:20b")).thinkLevels).toBe(true)
  })
  it("ne met pas en cache un échec et renvoie des capacités vides", async () => {
    const fetchMock = vi.fn(() => json({}, false, 404))
    vi.stubGlobal("fetch", fetchMock)
    expect(await getModelInfo("x")).toEqual({ tools: false, thinking: false, thinkLevels: false, maxCtx: null })
    await getModelInfo("x")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it("sépare le cache par adresse de serveur", async () => {
    const fetchMock = vi.fn(() => json({ capabilities: ["tools"] }))
    vi.stubGlobal("fetch", fetchMock)
    await getModelInfo("m")
    setOllamaUrl("http://autre:2")
    await getModelInfo("m")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
