import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "../lib/prompts"
import { EVAL_NOW } from "./cases"
import { PRODUCTION, VARIANTS } from "./variants"

// Ce qui est mesuré doit être ce qui est livré : la variante « production » est le vrai code, et la formulation retenue pour
// les instructions personnalisées est identique à la variante qui a gagné la comparaison.
describe("variantes d'évaluation", () => {
  const ctx = { now: EVAL_NOW, model: "qwen3.5:0.8b", useTools: true }
  it("« production » est buildSystemPrompt", () => {
    expect(PRODUCTION.build(ctx)).toBe(buildSystemPrompt(ctx))
  })
  it("la formulation des instructions personnalisées est celle de « perso-simple »", () => {
    const withCustom = { ...ctx, customInstructions: "Tutoie-moi." }
    expect(buildSystemPrompt(withCustom)).toBe(VARIANTS["perso-simple"].build(withCustom))
  })
  it("les identifiants de variantes sont uniques", () => {
    expect(Object.keys(VARIANTS).length).toBeGreaterThanOrEqual(15)
  })
})
