import { describe, expect, it } from "vitest"
import { CASES, EVAL_MODEL, EVAL_NOW, HELD_OUT_CASES, makeReply } from "./cases"

// « Évaluer l'évaluation » : un correcteur qui ne distingue pas une bonne d'une mauvaise réponse ne mesure rien.
const env = { now: EVAL_NOW, model: EVAL_MODEL }
const passes = (checks: Record<string, boolean>) => Object.values(checks).every(Boolean)

describe("jeu de cas d'évaluation", () => {
  it("a des identifiants uniques et des catégories variées", () => {
    const ids = CASES.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(CASES.map(c => c.category)).size).toBeGreaterThanOrEqual(7)
    expect(CASES.length).toBeGreaterThanOrEqual(30)
  })

  it("les cas mis de côté sont distincts de ceux de conception", () => {
    const ids = new Set(CASES.map(c => c.id))
    expect(HELD_OUT_CASES.every(c => !ids.has(c.id) && c.id.startsWith("ho-"))).toBe(true)
    expect(HELD_OUT_CASES.length).toBeGreaterThanOrEqual(12)
    const questions = new Set(CASES.map(c => c.messages[0].content))
    expect(HELD_OUT_CASES.every(c => !questions.has(c.messages[0].content))).toBe(true)
  })

  for (const c of [...CASES, ...HELD_OUT_CASES]) {
    it(`${c.id} : accepte la bonne réponse et refuse la mauvaise`, () => {
      expect(passes(c.grade(makeReply(c.good), env))).toBe(true)
      expect(passes(c.grade(makeReply(c.bad), env))).toBe(false)
    })
  }

  it("la date de référence est un mercredi", () => {
    expect(EVAL_NOW.toLocaleDateString("fr-FR", { weekday: "long" })).toBe("mercredi")
  })
})
