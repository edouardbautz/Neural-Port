import { describe, expect, it } from "vitest"
import { finalStats, NO_THINK_TAGS, parseChatChunk, splitStreamLines, splitThinkTags, toolFiles } from "./stream"

describe("splitStreamLines", () => {
  it("garde la ligne incomplète pour la lecture suivante", () => {
    const a = splitStreamLines("", '{"a":1}\n{"b":', false)
    expect(a.lines).toEqual(['{"a":1}'])
    const b = splitStreamLines(a.carry, '2}\n', false)
    expect(b.lines).toEqual(['{"b":2}'])
    expect(b.carry).toBe("")
  })
  it("traite la dernière ligne sans retour à la ligne quand le flux est terminé", () => {
    expect(splitStreamLines("", '{"done":true}', true)).toEqual({ lines: ['{"done":true}'], carry: "" })
  })
  it("ignore les lignes vides", () => {
    expect(splitStreamLines("", "\n\n  \n", false).lines).toEqual([])
  })
})

describe("parseChatChunk", () => {
  it("lit un objet JSON", () => {
    expect(parseChatChunk('{"message":{"content":"a"}}')).toEqual({ message: { content: "a" } })
  })
  it("renvoie null pour tout ce qui n'est pas un objet", () => {
    for (const bad of ["pas du json", "42", "null", "[1]", '"x"', ""]) expect(parseChatChunk(bad)).toBeNull()
  })
})

describe("toolFiles", () => {
  const call = (name: string, args: unknown) => ({ function: { name, arguments: args as Record<string, unknown> } })
  it("extrait les fichiers valides", () => {
    expect(toolFiles([call("create_file", { filename: "a.py", content: "x" })])).toEqual([{ filename: "a.py", content: "x" }])
  })
  it("ignore ce qui est mal formé sans jamais lever d'erreur", () => {
    expect(
      toolFiles([
        call("autre_outil", { filename: "a", content: "b" }),
        call("create_file", { filename: "  ", content: "b" }),
        call("create_file", { filename: "a", content: "" }),
        call("create_file", { filename: 3, content: "b" }),
        call("create_file", undefined),
        {} as never,
        null as never,
        { function: null } as never
      ])
    ).toEqual([])
    expect(toolFiles(undefined)).toEqual([])
  })
})

describe("splitThinkTags", () => {
  it("sans balise, affiche tout", () => {
    expect(splitThinkTags("Bonjour", NO_THINK_TAGS)).toMatchObject({ display: "Bonjour", inTag: false })
  })
  it("masque la réflexion en cours", () => {
    const r = splitThinkTags("Avant <think>je réfléchis", NO_THINK_TAGS)
    expect(r.display).toBe("Avant ")
    expect(r.inTag).toBe(true)
  })
  it("affiche la réponse après la balise fermante, avec le texte d'avant", () => {
    const r = splitThinkTags("Avant <think>idée</think>\n\nRéponse", NO_THINK_TAGS)
    expect(r.display).toBe("Avant Réponse")
    expect(r.inTag).toBe(false)
  })
  it("garde l'état entre deux fragments (la balise peut arriver en retard)", () => {
    const a = splitThinkTags("<think>début", NO_THINK_TAGS)
    const b = splitThinkTags("<think>début fin</think>OK", a.state)
    expect(b.display).toBe("OK")
    expect(b.state.openIdx).toBe(0)
  })
})

describe("finalStats", () => {
  it("renvoie les mesures réelles", () => {
    expect(finalStats({ prompt_eval_count: 100, eval_count: 50, eval_duration: 2e9 }, 0, 0)).toEqual({ ctxUsed: 150, promptTokens: 100, tokens: 50, seconds: 2 })
  })
  it("ajoute la réflexion interrompue estimée", () => {
    expect(finalStats({ eval_count: 50, eval_duration: 2e9 }, 10, 1)).toMatchObject({ tokens: 60, seconds: 3 })
  })
  it("n'invente rien quand les mesures manquent", () => {
    expect(finalStats({}, 0, 0)).toEqual({ ctxUsed: 0, promptTokens: null, tokens: null, seconds: 0 })
  })
})
