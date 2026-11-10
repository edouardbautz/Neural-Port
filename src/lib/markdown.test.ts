import { describe, expect, it } from "vitest"
import { repairFences } from "./markdown"

describe("repairFences", () => {
  it("supprime un fence nu parasite collé à une fermeture", () => {
    const bad = "Intro\n```\npip install pygame\n```\n```\n\n2.  **Lancer :**\n    ```bash\n    python jeu.py\n    ```\n\nFin"
    expect(repairFences(bad)).toBe("Intro\n```\npip install pygame\n```\n\n2.  **Lancer :**\n    ```bash\n    python jeu.py\n    ```\n\nFin")
  })

  it("ferme un bloc oublié avant l'ouverture d'un bloc avec langage", () => {
    expect(repairFences("```py\na\n```bash\nb\n```")).toBe("```py\na\n```\n```bash\nb\n```")
  })

  it("laisse intact un Markdown correct", () => {
    const ok = "a\n```py\nx=1\n```\nb\n````md\n```js\ny\n```\n````\n"
    expect(repairFences(ok)).toBe(ok)
    const ok2 = "```py\na\n```\n```bash\nb\n```"
    expect(repairFences(ok2)).toBe(ok2)
  })
})
