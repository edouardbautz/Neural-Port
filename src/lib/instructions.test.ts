import { describe, expect, it } from "vitest"
import { instructionsTokens, MAX_INSTRUCTIONS_CHARS, normalizeInstructions } from "./instructions"

describe("normalizeInstructions", () => {
  it("retire les espaces de bord et uniformise les retours à la ligne", () => {
    expect(normalizeInstructions("  Tutoie-moi.  \r\nSois bref.\t \r\n")).toBe("Tutoie-moi.\nSois bref.")
  })
  it("réduit les blocs de lignes vides", () => {
    expect(normalizeInstructions("a\n\n\n\n\nb")).toBe("a\n\nb")
  })
  it("plafonne la taille", () => {
    const long = "x".repeat(MAX_INSTRUCTIONS_CHARS + 500)
    expect(normalizeInstructions(long)).toHaveLength(MAX_INSTRUCTIONS_CHARS)
  })
  it("renvoie une chaîne vide pour un texte vide ou blanc", () => {
    expect(normalizeInstructions("   \n\n ")).toBe("")
  })
})

describe("instructionsTokens", () => {
  it("estime le coût en tokens", () => {
    expect(instructionsTokens("")).toBe(0)
    expect(instructionsTokens("x".repeat(36))).toBe(10)
  })
})
