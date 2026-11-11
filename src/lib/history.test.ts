import { describe, expect, it } from "vitest"
import type { Conversation } from "../App"
import { exportHistory, exportFilename, mergeConversations, parseImport, sanitizeConversations } from "./history"

const conv = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `t${id}`, createdAt: 1, updatedAt: 2,
  messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }],
  ...extra
})

describe("sanitizeConversations", () => {
  it("garde une conversation valide telle quelle", () => {
    const r = sanitizeConversations([conv("1")])
    expect(r.conversations).toHaveLength(1)
    expect(r.repaired).toBe(0)
    expect(r.skipped).toBe(0)
  })
  it("répare : écarte seulement le message invalide", () => {
    const bad = conv("1", { messages: [{ role: "user", content: "a" }, { role: "robot", content: "x" }, null, { role: "assistant", content: 3 }, { role: "assistant", content: "b" }] })
    const r = sanitizeConversations([bad])
    expect(r.conversations[0].messages.map(m => m.content)).toEqual(["a", "b"])
    expect(r.repaired).toBe(1)
  })
  it("écarte le résumé quand des messages ont été retirés ou quand il est incohérent", () => {
    const summary = { text: "s", notes: [], upTo: 1 }
    const dropped = sanitizeConversations([conv("1", { summary, messages: [{ role: "user", content: "a" }, { bad: true }, { role: "user", content: "c" }] })])
    expect(dropped.conversations[0].summary).toBeUndefined()
    const tooFar = sanitizeConversations([conv("1", { summary: { text: "s", upTo: 3 } })])
    expect(tooFar.conversations[0].summary).toBeUndefined()
    const ok = sanitizeConversations([conv("1", { summary })])
    expect(ok.conversations[0].summary?.upTo).toBe(1)
    expect(ok.conversations[0].summary?.notes).toEqual([])
  })
  it("complète titre et dates manquants, ignore les champs mal typés", () => {
    const r = sanitizeConversations([{ id: "x", messages: [], title: 5, updatedAt: "hier", calib: { tokens: "a" } }])
    expect(r.conversations[0]).toMatchObject({ id: "x", title: "Conversation sans titre", updatedAt: 0 })
    expect(r.conversations[0].calib).toBeUndefined()
  })
  it("écarte ce qui est inutilisable et les identifiants en double", () => {
    const r = sanitizeConversations([null, 4, { title: "sans id", messages: [] }, { id: "1" }, conv("2"), conv("2")])
    expect(r.conversations.map(c => c.id)).toEqual(["2"])
    expect(r.skipped).toBe(5)
  })
  it("renvoie une liste vide si ce n'est pas un tableau", () => {
    expect(sanitizeConversations({}).conversations).toEqual([])
  })
  it("valide les fichiers joints", () => {
    const f = { id: "f", name: "a.py", lang: "py", content: "x" }
    const r = sanitizeConversations([conv("1", { messages: [{ role: "assistant", content: "", files: [f, { name: 1 }] }] })])
    expect(r.conversations[0].messages[0].files).toEqual([f])
  })
})

describe("export / import", () => {
  it("fait l'aller-retour", () => {
    const original = sanitizeConversations([conv("1"), conv("2")]).conversations
    const parsed = parseImport(exportHistory(original))
    expect(parsed.ok && parsed.result.conversations).toEqual(original)
  })
  it("accepte une simple liste", () => {
    expect(parseImport(JSON.stringify([conv("1")])).ok).toBe(true)
  })
  it("refuse un fichier invalide avec un message clair", () => {
    expect(parseImport("pas du json")).toEqual({ ok: false, error: "Ce fichier n'est pas un JSON valide." })
    expect(parseImport('{"a":1}').ok).toBe(false)
    expect(parseImport("[]")).toMatchObject({ ok: false, error: "Ce fichier ne contient aucune conversation." })
    expect(parseImport("[1,2]")).toMatchObject({ ok: false, error: "Aucune conversation exploitable dans ce fichier." })
  })
  it("fusionne sans dupliquer les identifiants existants", () => {
    const a = sanitizeConversations([conv("1")]).conversations
    const b = sanitizeConversations([conv("1"), conv("2")]).conversations
    const { merged, added } = mergeConversations(a as Conversation[], b)
    expect(added).toBe(1)
    expect(merged.map(c => c.id)).toEqual(["1", "2"])
  })
  it("nomme le fichier avec la date", () => {
    expect(exportFilename(new Date(2026, 0, 5))).toBe("neural-port-2026-01-05.json")
  })
})
