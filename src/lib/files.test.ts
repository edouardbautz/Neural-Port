import { describe, expect, it } from "vitest"
import { extensionFor, extractCodeBlocks, filenameFromRequest, isFileRequest, makeFile } from "./files"

describe("extractCodeBlocks", () => {
  it("extrait les blocs fermés et ignore le bloc encore ouvert", () => {
    const md = "Voici:\n```python\nprint(1)\n```\ntexte\n~~~js\nlet a=1\n~~~\n```py\nencore ouvert"
    const blocks = extractCodeBlocks(md)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ lang: "python", code: "print(1)" })
    expect(blocks[1].code).toBe("let a=1")
  })

  it("ignore les blocs vides et gère les blocs imbriqués", () => {
    expect(extractCodeBlocks("```\n\n```")).toHaveLength(0)
    expect(extractCodeBlocks("````md\n```js\nx\n```\n````")).toHaveLength(1)
  })
})

describe("filenameFromRequest", () => {
  it("trouve un nom de fichier cité", () => {
    expect(filenameFromRequest("Crée-moi un fichier hello.py qui affiche")).toBe("hello.py")
    expect(filenameFromRequest("mets ça dans src/app.test.ts.")).toBe("src/app.test.ts")
  })
  it("ne confond pas avec un numéro de version ou une fin de phrase", () => {
    expect(filenameFromRequest("version 1.2 stp")).toBeNull()
    expect(filenameFromRequest("Bonjour. Écris un jeu")).toBeNull()
  })
  it("ignore les abréviations et les extensions inconnues", () => {
    expect(filenameFromRequest("explique les langages, e.g. Python")).toBeNull()
    expect(filenameFromRequest("c'est-à-dire i.e. simplement")).toBeNull()
    expect(filenameFromRequest("un fichier foo.zzzz")).toBeNull()
    expect(filenameFromRequest("Explique-moi comment marche Node.js")).toBeNull()
    expect(isFileRequest("Différence entre Vue.js et React.js ?")).toBe(false)
    expect(filenameFromRequest("crée jeu.js")).toBe("jeu.js")
  })
})

describe("isFileRequest", () => {
  it("détecte une demande de fichier", () => {
    expect(isFileRequest("Écris un script dans un fichier")).toBe(true)
    expect(isFileRequest("crée main.py")).toBe(true)
    expect(isFileRequest("Download it please")).toBe(true)
  })
  it("ne se déclenche pas sur une question ordinaire", () => {
    expect(isFileRequest("Explique-moi les langages, e.g. Python")).toBe(false)
    expect(isFileRequest("Résume ce texte en trois phrases")).toBe(false)
  })
})

describe("makeFile / extensionFor", () => {
  it("rend les noms uniques et inoffensifs", () => {
    const a = makeFile("a.py", "x", null, [])
    expect(makeFile("a.py", "y", null, [a]).name).toBe("a (2).py")
    const evil = makeFile("../../etc/pw:d", "z", null, [])
    expect(evil.name).not.toMatch(/[/:]/)
  })
  it("déduit l'extension du langage", () => {
    expect(extensionFor("Python")).toBe("py")
    expect(extensionFor(null)).toBe("txt")
  })
})
