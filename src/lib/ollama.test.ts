import { describe, expect, it } from "vitest"
import { DEFAULT_OLLAMA_URL, normalizeOllamaUrl } from "./ollama"

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
