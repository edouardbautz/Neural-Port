import { describe, expect, it } from "vitest"
import {
  buildSummarizerMessages,
  cleanSummary,
  compactConversation,
  mergeNotes,
  summaryBody,
  userNotes,
  estimatePromptTokens,
  FILE_CONTEXT_MAX_CHARS,
  toModelMessages,
  modelMessagesChars,
  fileContext,
  messageText,
  planCompaction,
  requestChars,
  serializeMessages,
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

  it("requestChars compte le résumé et le surcoût des consignes", () => {
    const base = requestChars([user("abc")], undefined, 0)
    expect(requestChars([user("abc")], { text: "résumé", notes: [] }, 0)).toBeGreaterThan(base)
    expect(requestChars([user("abc")], undefined, 500)).toBe(base + 500)
  })

  it("écrit les consignes de résumé dans la langue de la conversation", () => {
    const fr = buildSummarizerMessages(undefined, "UTILISATEUR :\nJe voudrais réserver une table pour deux personnes dans le restaurant que vous m'avez conseillé.", 300)
    const en = buildSummarizerMessages(undefined, "USER:\nI would like to book a table for two people at the restaurant that you recommended to me.", 300)
    expect(fr[0].content).toContain("français")
    expect(fr[1].content).toContain("ÉCHANGES")
    expect(en[0].content).toContain("in English")
    expect(en[1].content).toContain("CONVERSATION")
    expect(en[0].content).not.toContain("français")
  })
  it("étiquette les rôles dans la langue de la conversation", () => {
    const en = serializeMessages([{ role: "user", content: "I would like to book a table for two people tonight." }, { role: "assistant", content: "Sure, which restaurant would you like to go to?" }])
    expect(en).toContain("USER:")
    expect(en).not.toContain("UTILISATEUR")
    const fr = serializeMessages([{ role: "user", content: "Je voudrais réserver une table pour deux personnes ce soir." }, { role: "assistant", content: "Bien sûr, dans quel restaurant souhaitez-vous aller ?" }])
    expect(fr).toContain("UTILISATEUR :")
  })
  it("tient compte du résumé précédent pour choisir la langue", () => {
    const en = buildSummarizerMessages("- The user plans a trip to Lisbon with her sister and has a budget of nine hundred euros.", "USER: ok", 300)
    expect(en[1].content).toContain("CURRENT SUMMARY")
  })

  it("shouldCompact applique le seuil", () => {
    expect(shouldCompact(7100, 10000, 0.7)).toBe(true)
    expect(shouldCompact(6900, 10000, 0.7)).toBe(false)
  })
})

describe("construction des messages", () => {
  it("rappelle les fichiers créés avec leur contenu : le modèle doit savoir ce qu'il a écrit", () => {
    const m: M = { ...bot("voilà"), files: [{ id: "1", name: "a.py", lang: "py", content: "TAUX = 0.2\nprint(TAUX)\n" }] }
    const text = messageText(m)
    expect(text).toContain("voilà")
    expect(text).toContain("[File created: a.py]")
    expect(text).toContain("```py\nTAUX = 0.2\nprint(TAUX)\n```")
  })

  it("un message d'outil sans texte contient quand même le fichier", () => {
    const m: M = { ...bot(""), files: [{ id: "1", name: "config.json", lang: "json", content: "{\"port\": 8081}" }] }
    expect(messageText(m)).toContain("8081")
    expect(messageText(m).startsWith("[File created: config.json]")).toBe(true)
  })

  it("ne répète pas un fichier dont le contenu est déjà dans le texte (bloc de code transformé en fichier)", () => {
    const code = "def f():\n    return 1"
    const m: M = { ...bot("Voici :\n```python\n" + code + "\n```"), files: [{ id: "1", name: "code-1.py", lang: "py", content: code + "\n" }] }
    const text = messageText(m)
    expect(text).toContain("[File created: code-1.py]")
    expect(text.split("def f()").length - 1).toBe(1)
  })

  it("tronque un fichier très long au milieu en gardant le début et la fin", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `ligne ${i}`)
    const text = fileContext({ id: "1", name: "gros.txt", lang: "text", content: lines.join("\n") })
    expect(text.length).toBeLessThan(FILE_CONTEXT_MAX_CHARS + 300)
    expect(text).toContain("ligne 0")
    expect(text).toContain("ligne 1999")
    expect(text).toMatch(/\[… \d+ lines omitted …\]/)
  })

  it("utilise une clôture plus longue quand le fichier contient lui-même des blocs de code", () => {
    const text = fileContext({ id: "1", name: "README.md", lang: "md", content: "Exemple :\n```js\nx\n```\n" })
    expect(text).toContain("````md")
  })

  it("rejoue un fichier créé par l'outil comme l'appel qui l'a produit (modèle avec outils)", () => {
    const file = { id: "1", name: "tva.py", lang: "py", content: "TAUX_TVA = 0.2\n" }
    const out = toModelMessages([user("Crée tva.py"), { ...bot("Prêt."), files: [file] }, user("Quel taux ?")], true)
    expect(out.map(m => m.role)).toEqual(["user", "assistant", "tool", "user"])
    expect(out[1].content).toBe("Prêt.")
    expect(out[1].tool_calls).toEqual([{ function: { name: "create_file", arguments: { filename: "tva.py", content: "TAUX_TVA = 0.2" } } }])
    expect(out[2]).toEqual({ role: "tool", tool_name: "create_file", content: "File created: tva.py" })
  })

  it("rejoue plusieurs fichiers d'un même message, et un message sans texte", () => {
    const files = [{ id: "1", name: "a.py", lang: "py", content: "a" }, { id: "2", name: "b.py", lang: "py", content: "b" }]
    const out = toModelMessages([{ ...bot(""), files }], true)
    expect(out.map(m => m.role)).toEqual(["assistant", "tool", "tool"])
    expect(out[0].content).toBe("")
    expect(out[0].tool_calls).toHaveLength(2)
  })

  it("retombe sur du texte quand le modèle ne gère pas les outils", () => {
    const out = toModelMessages([{ ...bot("Prêt."), files: [{ id: "1", name: "a.py", lang: "py", content: "x = 1" }] }], false)
    expect(out).toHaveLength(1)
    expect(out[0].tool_calls).toBeUndefined()
    expect(out[0].content).toContain("x = 1")
  })

  it("ne rejoue pas comme appel d'outil un fichier tiré d'un bloc de code déjà dans le texte", () => {
    const code = "print(1)"
    const out = toModelMessages([{ ...bot("Voici :\n```python\n" + code + "\n```"), files: [{ id: "1", name: "code-1.py", lang: "py", content: code + "\n" }] }], true)
    expect(out).toHaveLength(1)
    expect(out[0].tool_calls).toBeUndefined()
    expect(out[0].content).toContain("[File created: code-1.py]")
  })

  it("les messages sans fichier ne changent pas", () => {
    expect(toModelMessages([user("a"), bot("b")], true)).toEqual([{ role: "user", content: "a" }, { role: "assistant", content: "b" }])
  })

  it("compte les appels d'outil dans la taille de la requête", () => {
    const withFile: M = { ...bot("ok"), files: [{ id: "1", name: "a.py", lang: "py", content: "y".repeat(500) }] }
    expect(modelMessagesChars(toModelMessages([withFile], true))).toBeGreaterThan(500)
    expect(requestChars([withFile], undefined, 0, true)).toBeGreaterThan(requestChars([bot("ok")], undefined, 0, true) + 500)
  })

  it("compte le contenu des fichiers dans la taille de la requête", () => {
    const withFile: M = { ...bot("ok"), files: [{ id: "1", name: "a.py", lang: "py", content: "y".repeat(500) }] }
    expect(requestChars([withFile], undefined, 0)).toBeGreaterThan(500)
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
