import { describe, expect, it } from "vitest"
import { countBullets, countSentences, dateForms, detectLanguage, languageMatches, fenceReport, hasValidTable, hedges, includesAll, leaksThinkTags, startsWithFiller } from "./graders"
import { clearlyDifferent, median, wilson } from "./stats"

describe("detectLanguage", () => {
  it("reconnaît le français et l'anglais", () => {
    expect(detectLanguage("Les closures sont des fonctions qui gardent l'accès aux variables de leur portée.")).toBe("fr")
    expect(detectLanguage("Closures are functions that keep access to the variables of their scope.")).toBe("en")
  })
  it("ignore le code", () => {
    expect(detectLanguage("```python\nthe and is are of to in that for with\n```\nVoici la fonction que vous avez demandée pour le calcul.")).toBe("fr")
  })
  it("ne tranche pas sur un texte trop court ou ambigu", () => {
    expect(detectLanguage("Oui.")).toBe("unknown")
    expect(detectLanguage("OK")).toBe("unknown")
  })
})

describe("languageMatches", () => {
  it("accepte une réponse très courte dans la bonne langue ou indéterminée", () => {
    expect(languageMatches("Today is Wednesday, November 11, 2026 (Europe/Paris).", "en")).toBe(true)
    expect(languageMatches("Oui.", "fr")).toBe(true)
  })
  it("refuse la langue opposée, même courte", () => {
    expect(languageMatches("Nous sommes le mercredi 11 novembre, c'est une belle journée.", "en")).toBe(false)
    expect(languageMatches("It is a sunny day and we are in the park.", "fr")).toBe(false)
  })
  it("refuse un long texte indéterminé", () => {
    expect(languageMatches("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu", "en")).toBe(false)
  })
})

describe("fenceReport", () => {
  it("compte les blocs, les langages et détecte un bloc non fermé", () => {
    const ok = fenceReport("Texte\n```python\nprint(1)\n```\net\n```js\nx\n```")
    expect(ok).toMatchObject({ blocks: 2, unclosed: false, untagged: 0, languages: ["python", "js"] })
    expect(fenceReport("```python\nprint(1)\n").unclosed).toBe(true)
  })
  it("compte les blocs sans langage", () => {
    expect(fenceReport("```\nx\n```").untagged).toBe(1)
  })
  it("une ligne « ```bash » ne ferme jamais un bloc ouvert", () => {
    expect(fenceReport("```python\nx\n```bash\ny\n").unclosed).toBe(true)
  })
})

describe("mise en forme", () => {
  it("compte les puces et les listes numérotées", () => {
    expect(countBullets("- a\n- b\n* c\n1. d\n2) e\ntexte")).toBe(5)
  })
  it("compte les phrases sans se tromper sur les décimaux ni le code", () => {
    expect(countSentences("Paris est la capitale de la France.")).toBe(1)
    expect(countSentences("Il vaut 3.14 environ. C'est un nombre irrationnel.")).toBe(2)
    expect(countSentences("Voici `a.b()` utile :\n```js\nx.y()\n```")).toBe(1)
  })
  it("valide un tableau Markdown", () => {
    expect(hasValidTable("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |")).toBe(true)
    expect(hasValidTable("| a | b |\n| 1 | 2 |")).toBe(false)
    expect(hasValidTable("| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| 4 |")).toBe(false)
  })
})

describe("honnêteté et style", () => {
  it("détecte l'aveu d'ignorance en français et en anglais", () => {
    expect(hedges("Je ne connais pas ce livre.")).toBe(true)
    expect(hedges("I'm not aware of any such book.")).toBe(true)
    expect(hedges("Non, je ne suis pas connecté à l'Internet actuellement.")).toBe(true)
    expect(hedges("No, I'm not connected to the Internet.")).toBe(true)
    expect(hedges("Le livre raconte l'histoire d'une famille de pêcheurs.")).toBe(false)
  })
  it("détecte les formules d'introduction creuses", () => {
    expect(startsWithFiller("Bien sûr ! Voici la réponse.")).toBe(true)
    expect(startsWithFiller("**Absolument**, voici")).toBe(true)
    expect(startsWithFiller("Certainly! Here is")).toBe(true)
    expect(startsWithFiller("Paris est la capitale.")).toBe(false)
    expect(startsWithFiller("Surement pas.")).toBe(false)
  })
  it("détecte une fuite de balise de réflexion", () => {
    expect(leaksThinkTags("<think>hmm</think>Réponse")).toBe(true)
    expect(leaksThinkTags("Réponse")).toBe(false)
  })
  it("includesAll ignore la casse", () => {
    expect(includesAll("Bonjour Monde", ["bonjour", "MONDE"])).toBe(true)
    expect(includesAll("Bonjour", ["monde"])).toBe(false)
  })
})

describe("dateForms", () => {
  it("propose plusieurs écritures de la même date", () => {
    const f = dateForms(new Date(2026, 10, 11))
    expect(f.fr).toContain("11 novembre 2026")
    expect(f.fr).toContain("11/11/2026")
    expect(f.en).toContain("November 11, 2026")
  })
})

describe("stats", () => {
  it("calcule l'intervalle de Wilson", () => {
    const w = wilson(8, 10)
    expect(w.rate).toBe(0.8)
    expect(w.low).toBeCloseTo(0.49, 1)
    expect(w.high).toBeCloseTo(0.94, 1)
    expect(wilson(0, 0).rate).toBe(0)
    expect(wilson(10, 10).high).toBe(1)
  })
  it("ne conclut à une différence que si les intervalles sont disjoints", () => {
    expect(clearlyDifferent(wilson(95, 100), wilson(40, 100))).toBe(true)
    expect(clearlyDifferent(wilson(8, 10), wilson(6, 10))).toBe(false)
  })
  it("médiane", () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})
