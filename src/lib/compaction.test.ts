import { describe, expect, it } from "vitest"
import {
  buildSummarizerMessages,
  cleanSummary,
  compactConversation,
  mergeNotes,
  summaryBody,
  userNotes,
  estimatePromptTokens,
  messageText,
  planCompaction,
  requestChars,
  shouldCompact,
  splitChunks,
  summaryInjection,
  visibleThread,
  type ConversationSummary
} from "./compaction"

type M = { role: "user" | "assistant"; content: string; notice?: boolean; files?: { id: string; name: string; lang: string; content: string }[] }

const user = (content: string): M => ({ role: "user", content })
const bot = (content: string): M => ({ role: "assistant", content })
const filler = (n: number) => "x".repeat(n)

// n échanges (question + réponse) de `size` caractères chacun
function conversation(turns: number, size: number): M[] {
  return Array.from({ length: turns }, (_, i) => [user(`q${i} ${filler(size)}`), bot(`a${i} ${filler(size)}`)]).flat()
}

describe("planCompaction", () => {
  it("coupe sur une frontière de question et garde le dernier message utilisateur", () => {
    const msgs = [...conversation(10, 1000), user("dernière question")]
    const plan = planCompaction(msgs, 0, 4000, 4)!
    expect(plan).not.toBeNull()
    expect(msgs[plan.cut].role).toBe("user")
    expect(plan.cut).toBeLessThanOrEqual(msgs.length - 1)
    expect(plan.head.length).toBe(plan.cut)
  })

  it("la queue conservée respecte le budget quand c'est possible", () => {
    const msgs = [...conversation(20, 400), user("fin")]
    const ctx = 4000
    const plan = planCompaction(msgs, 0, ctx, 4)!
    expect(plan.tailTokens).toBeLessThanOrEqual(ctx * 0.25 + 10)
  })

  it("ne coupe jamais le dernier message utilisateur même s'il est énorme", () => {
    const msgs = [...conversation(3, 100), user(filler(100000))]
    const plan = planCompaction(msgs, 0, 2048, 4)!
    expect(plan.cut).toBe(msgs.length - 1)
  })

  it("renvoie null s'il n'y a rien d'antérieur à résumer", () => {
    expect(planCompaction([user("seul")], 0, 4096, 4)).toBeNull()
    expect(planCompaction([user("a"), bot("b"), user("c")], 2, 4096, 4)).toBeNull()
  })

  it("reprend après le résumé existant (from)", () => {
    const msgs = [...conversation(10, 500), user("fin")]
    const plan = planCompaction(msgs, 8, 2048, 4)!
    expect(plan.head.length).toBe(plan.cut - 8)
    expect(plan.cut).toBeGreaterThan(8)
  })

  it("ignore les messages d'information de l'appli dans la tête", () => {
    const msgs: M[] = [user("a"), { ...bot("erreur"), notice: true }, user("b"), bot("c"), user("d")]
    const plan = planCompaction(msgs, 0, 100, 4)!
    expect(plan.head.some(m => m.notice)).toBe(false)
  })
})

describe("splitChunks", () => {
  it("découpe sans dépasser la taille d'un lot et préserve l'ordre", () => {
    const msgs = conversation(12, 800)
    const chunks = splitChunks(msgs, 500, 4) // ~2000 caractères par lot
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat().map(m => m.content.slice(0, 2))).toEqual(msgs.map(m => m.content.slice(0, 2)))
    for (const c of chunks) {
      const chars = c.reduce((s, m) => s + m.content.length, 0)
      expect(chars).toBeLessThan(2600)
    }
  })

  it("tronque au milieu un message plus gros qu'un lot", () => {
    const [chunk] = splitChunks([user(filler(50000))], 500, 4)
    expect(messageText(chunk[0]).length).toBeLessThan(2100)
    expect(chunk[0].content).toContain("tronqué")
  })
})

describe("estimation de la requête", () => {
  it("s'appuie sur la mesure réelle précédente et ne corrige que l'écart", () => {
    const calibration = { tokens: 1000, chars: 4000 }
    expect(estimatePromptTokens(4000, 4, calibration)).toBe(1000)
    expect(estimatePromptTokens(4400, 4, calibration)).toBe(1100)
  })

  it("estime à partir des caractères sans mesure", () => {
    expect(estimatePromptTokens(3600, 2, undefined)).toBeGreaterThan(1000)
  })

  it("requestChars compte le résumé et les outils", () => {
    const base = requestChars([user("abc")], undefined, false)
    expect(requestChars([user("abc")], { text: "résumé", notes: [] }, false)).toBeGreaterThan(base)
    expect(requestChars([user("abc")], undefined, true)).toBeGreaterThan(base)
  })

  it("shouldCompact applique le seuil", () => {
    expect(shouldCompact(7100, 10000, 0.7)).toBe(true)
    expect(shouldCompact(6900, 10000, 0.7)).toBe(false)
  })
})

describe("construction des messages", () => {
  it("rappelle les fichiers créés dans le texte du message", () => {
    const m: M = { ...bot("voilà"), files: [{ id: "1", name: "a.py", lang: "py", content: "x" }] }
    expect(messageText(m)).toContain("[Fichiers créés : a.py]")
  })

  it("visibleThread ne renvoie que les messages non résumés et non informatifs", () => {
    const msgs: M[] = [user("a"), bot("b"), { ...bot("err"), notice: true }, user("c")]
    expect(visibleThread(msgs, 2).map(m => m.content)).toEqual(["c"])
  })

  it("le prompt de résumé contient l'ancien résumé, les nouveaux échanges et la taille cible", () => {
    const [sys, usr] = buildSummarizerMessages("ancien résumé", "UTILISATEUR : salut", 300)
    expect(sys.role).toBe("system")
    expect(usr.content).toContain("ancien résumé")
    expect(usr.content).toContain("salut")
    expect(usr.content).toContain("300 tokens")
    expect(summaryInjection({ text: " R ", notes: ["Je m'appelle Camille"] })).toContain("Camille")
  })
})

describe("compactConversation", () => {
  const summarizer = (calls: string[]) => async (previous: string | undefined, text: string) => {
    calls.push(`${previous ?? "-"}|${text.length}`)
    return "résumé court"
  }

  it("produit un résumé qui avance upTo et réduit la taille", async () => {
    const msgs = [...conversation(10, 1500), user("dernière question")]
    const calls: string[] = []
    const res = await compactConversation({ messages: msgs, previous: undefined, ctx: 8192, ratio: 4, auto: true, summarize: summarizer(calls) })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.summary.upTo).toBeGreaterThan(0)
      expect(res.summary.upTo).toBeLessThan(msgs.length)
      expect(msgs[res.summary.upTo].role).toBe("user")
      expect(res.summary.tokensAfter).toBeLessThan(res.summary.tokensBefore)
      expect(res.summary.messagesCovered).toBe(res.summary.upTo)
    }
  })

  it("résume en plusieurs lots quand le contenu dépasse la fenêtre, en chaînant les résumés", async () => {
    const msgs = [...conversation(30, 3000), user("fin")]
    const calls: string[] = []
    const res = await compactConversation({ messages: msgs, previous: undefined, ctx: 4096, ratio: 4, auto: true, summarize: summarizer(calls) })
    expect(res.ok).toBe(true)
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[0].startsWith("-|")).toBe(true)
    expect(calls[1].startsWith("résumé court|")).toBe(true)
  })

  it("fusionne avec le résumé précédent (résumé roulant)", async () => {
    const msgs = [...conversation(16, 1500), user("fin")]
    const previous: ConversationSummary = { text: "ancien", notes: ["ancienne note"], upTo: 6, messagesCovered: 6, tokensBefore: 100, tokensAfter: 5, createdAt: 0, auto: true }
    const calls: string[] = []
    const res = await compactConversation({ messages: msgs, previous, ctx: 8192, ratio: 4, auto: true, summarize: summarizer(calls) })
    expect(res.ok).toBe(true)
    expect(calls[0].startsWith("ancien|")).toBe(true)
    if (res.ok) {
      expect(res.summary.upTo).toBeGreaterThan(6)
      expect(res.summary.notes[0]).toBe("ancienne note") // les notes précédentes sont conservées
    }
  })

  it("refuse un résumé vide ou aussi long que la source", async () => {
    const msgs = [...conversation(10, 1500), user("fin")]
    const empty = await compactConversation({ messages: msgs, previous: undefined, ctx: 8192, ratio: 4, auto: true, summarize: async () => "  " })
    expect(empty).toEqual({ ok: false, reason: "invalid" })
    const long = await compactConversation({ messages: msgs, previous: undefined, ctx: 8192, ratio: 4, auto: true, summarize: async () => filler(200000) })
    expect(long).toEqual({ ok: false, reason: "invalid" })
  })

  it("signale qu'il n'y a rien à compacter", async () => {
    const res = await compactConversation({ messages: [user("seul")], previous: undefined, ctx: 8192, ratio: 4, auto: false, summarize: async () => "x" })
    expect(res).toEqual({ ok: false, reason: "nothing" })
  })

  it("propage l'erreur du résumeur (arrêt utilisateur, panne Ollama)", async () => {
    const msgs = [...conversation(10, 1500), user("fin")]
    await expect(
      compactConversation({ messages: msgs, previous: undefined, ctx: 8192, ratio: 4, auto: true, summarize: async () => { throw new Error("boom") } })
    ).rejects.toThrow("boom")
  })
})

describe("extraits fidèles des messages utilisateur", () => {
  it("conserve les faits mot pour mot, sur une ligne, tronqués si trop longs", () => {
    const notes = userNotes([user("Je m'appelle Camille\net mon nombre préféré est 42."), bot("ok"), user("x".repeat(500))])
    expect(notes[0]).toBe("Je m'appelle Camille et mon nombre préféré est 42.")
    expect(notes[1].length).toBeLessThanOrEqual(220)
    expect(notes[1].endsWith("…")).toBe(true)
    expect(notes).toHaveLength(2)
  })

  it("respecte le plafond en sacrifiant le milieu et garde début et fin", () => {
    const all = Array.from({ length: 30 }, (_, i) => `note numéro ${i} ${"y".repeat(60)}`)
    const merged = mergeNotes(all.slice(0, 20), all.slice(20), 800)
    expect(merged.reduce((s, n) => s + n.length + 3, 0)).toBeLessThanOrEqual(800)
    expect(merged[0]).toBe(all[0])
    expect(merged[merged.length - 1]).toBe(all[29])
  })

  it("summaryBody ajoute les notes au texte du modèle", () => {
    const body = summaryBody({ text: "Résumé", notes: ["a", "b"] })
    expect(body).toContain("Résumé")
    expect(body).toContain("- a")
    expect(body).toContain("- b")
  })

  it("le résumé final contient les notes de la partie résumée", async () => {
    const msgs = [user("Je m'appelle Camille et j'aime le 42."), bot(filler(3000)), ...conversation(8, 1500), user("fin")]
    const res = await compactConversation({ messages: msgs, previous: undefined, ctx: 8192, ratio: 4, auto: true, summarize: async () => "résumé court" })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.summary.notes[0]).toContain("Camille")
  })
})

describe("cleanSummary", () => {
  it("retire les rubriques vides recopiées de la consigne", () => {
    const raw = "**Objectif :** voyage à Lisbonne\n**Code et fichiers :** Aucun fichier créé ou discuté.\n**Faits :** Hugo, 42"
    const out = cleanSummary(raw)
    expect(out).toContain("Objectif")
    expect(out).toContain("Hugo")
    expect(out).not.toContain("Aucun")
  })
  it("ne touche pas aux phrases normales contenant « aucun »", () => {
    expect(cleanSummary("Il n'y a aucun problème de réservation.")).toBe("Il n'y a aucun problème de réservation.")
  })
})
