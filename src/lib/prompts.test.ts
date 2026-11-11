import { describe, expect, it } from "vitest"
import { buildSystemPrompt, CREATE_FILE_TOOL, customBlock, formatDay, formatNow, TOOL_DEFINITION_CHARS } from "./prompts"

const noon = new Date(2026, 10, 11, 12, 0)

describe("buildSystemPrompt", () => {
  it("est identique toute la journée : le cache de préfixe d'Ollama est conservé d'un message à l'autre", () => {
    const morning = buildSystemPrompt({ now: new Date(2026, 10, 11, 0, 1), model: "m", useTools: false })
    const evening = buildSystemPrompt({ now: new Date(2026, 10, 11, 23, 59), model: "m", useTools: false })
    expect(morning).toBe(evening)
  })
  it("ne contient aucune heure", () => {
    expect(buildSystemPrompt({ now: noon, model: "m", useTools: true })).not.toMatch(/\b\d{1,2}[:h]\d{2}\b/)
  })
  it("change le lendemain", () => {
    const a = buildSystemPrompt({ now: new Date(2026, 10, 11), model: "m", useTools: false })
    const b = buildSystemPrompt({ now: new Date(2026, 10, 12), model: "m", useTools: false })
    expect(a).not.toBe(b)
  })
  it("donne la date et le modèle", () => {
    const p = buildSystemPrompt({ now: noon, model: "qwen3.5:0.8b", useTools: false })
    expect(p).toContain("qwen3.5:0.8b")
    expect(p).toContain("November 11, 2026")
    expect(p).toContain("Wednesday")
  })
  it("fonctionne sans nom de modèle", () => {
    expect(buildSystemPrompt({ now: noon, useTools: false })).not.toContain("undefined")
  })
  it("ne parle de l'outil que s'il est proposé", () => {
    expect(buildSystemPrompt({ now: noon, model: "m", useTools: false })).not.toContain("create_file")
    expect(buildSystemPrompt({ now: noon, model: "m", useTools: true })).toContain("create_file")
  })
  it("reste court : chaque token du prompt réduit la fenêtre de contexte (budget : 500 caractères, outil compris)", () => {
    expect(buildSystemPrompt({ now: noon, model: "qwen3.5:0.8b", useTools: true }).length).toBeLessThanOrEqual(500)
  })
  it("demande de répondre dans la langue de l'utilisateur et d'avouer son ignorance", () => {
    const p = buildSystemPrompt({ now: noon, model: "m", useTools: false })
    expect(p).toContain("Reply in the user's language")
    expect(p).toContain("never make things up")
  })
  it("est rédigé en anglais : un prompt en français fait répondre en français à des questions en anglais", () => {
    expect(buildSystemPrompt({ now: noon, model: "m", useTools: true })).not.toMatch(/\b(Tu|Réponds|Nous sommes)\b/)
  })
})

describe("instructions personnalisées", () => {
  const base = { now: noon, model: "m", useTools: false }
  it("sont ajoutées à la fin, sous un intitulé neutre", () => {
    const p = buildSystemPrompt({ ...base, customInstructions: "Tutoie-moi." })
    expect(p.endsWith("Additional instructions:\nTutoie-moi.")).toBe(true)
  })
  it("ne changent rien quand elles sont vides ou blanches", () => {
    const plain = buildSystemPrompt(base)
    expect(buildSystemPrompt({ ...base, customInstructions: "" })).toBe(plain)
    expect(buildSystemPrompt({ ...base, customInstructions: "  \n " })).toBe(plain)
    expect(customBlock(undefined)).toEqual([])
  })
  it("laissent le prompt stable : même texte, même prompt (cache de préfixe)", () => {
    const a = buildSystemPrompt({ ...base, customInstructions: "Sois bref." })
    const b = buildSystemPrompt({ ...base, now: new Date(2026, 10, 11, 23, 0), customInstructions: "Sois bref." })
    expect(a).toBe(b)
  })
  it("passent après la ligne de l'outil", () => {
    const p = buildSystemPrompt({ ...base, useTools: true, customInstructions: "X" })
    expect(p.indexOf("create_file")).toBeLessThan(p.indexOf("X"))
  })
})

describe("formatDay / formatNow", () => {
  it("formatDay n'a pas d'heure, formatNow en a une", () => {
    expect(formatDay(noon, "fr-FR")).toContain("mercredi 11 novembre 2026")
    expect(formatDay(noon, "fr-FR")).not.toMatch(/\d{2}:\d{2}/)
    expect(formatNow(noon, "fr-FR")).toMatch(/12:00/)
  })
})

describe("outil create_file", () => {
  it("exige un nom de fichier et un contenu", () => {
    expect(CREATE_FILE_TOOL.function.parameters.required).toEqual(["filename", "content"])
  })
  it("a une taille connue, comptée dans la fenêtre de contexte", () => {
    expect(TOOL_DEFINITION_CHARS).toBe(JSON.stringify(CREATE_FILE_TOOL).length)
    expect(TOOL_DEFINITION_CHARS).toBeLessThan(400)
  })
})
