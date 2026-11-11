import { describe, expect, it } from "vitest"
import { gradeSummary, numbersIn, SUMMARY_CASES } from "./summary"

const passes = (g: ReturnType<typeof gradeSummary>) => Object.values(g.checks).every(Boolean)

describe("évaluation du résumé : le correcteur", () => {
  for (const c of SUMMARY_CASES) {
    it(`${c.id} : accepte le bon résumé et refuse le mauvais`, () => {
      expect(passes(gradeSummary(c.good, c))).toBe(true)
      expect(passes(gradeSummary(c.bad, c))).toBe(false)
    })
  }

  it("détecte un fait manquant et le nomme", () => {
    const c = SUMMARY_CASES[0]
    const g = gradeSummary("- Voyage à Lisbonne avec Camille.", c)
    expect(g.recall).toBeLessThan(1)
    expect(g.missing).toContain("Sintra")
  })

  it("accepte plusieurs écritures d'un même nombre", () => {
    const c = SUMMARY_CASES[1]
    const base = c.good.replace("200 000", "200000")
    expect(gradeSummary(base, c).checks["tous les faits conservés"]).toBe(true)
  })

  it("repère un nombre inventé mais pas un nombre de la source", () => {
    const c = SUMMARY_CASES[3]
    expect(gradeSummary(c.good + "\n- Limite aussi de 999 requêtes par heure.", c).inventedNumbers).toEqual(["999"])
    expect(gradeSummary(c.good, c).inventedNumbers).toEqual([])
  })

  it("refuse un commentaire sur la tâche et une mauvaise langue", () => {
    const c = SUMMARY_CASES[2]
    expect(gradeSummary("Voici le résumé : " + c.good, c).checks["sans commentaire sur la tâche"]).toBe(false)
    expect(gradeSummary("- Le lancement d'Orion est reporté du 30 avril au 21 mai à cause de 12 bugs critiques.", c).checks["langue de la conversation"]).toBe(false)
  })

  it("numbersIn ignore les numéros de liste et les nombres à un chiffre", () => {
    expect(numbersIn("1. un\n2. deux\nIl y a 3 chats et 200 000 lignes, 45 s")).toEqual(["200000", "45"])
  })
})
