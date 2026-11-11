// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Conversation } from "../App"
import { createIndexedDbStore, createLocalStorageStore, getStore, LEGACY_HISTORY_KEY, loadConversations, resetStoreForTests } from "./conversationStore"
import { closeDb, DB_NAME } from "./idb"

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, title: id, createdAt: 1, updatedAt: 2, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], ...extra
})

beforeEach(() => localStorage.clear())
afterEach(async () => {
  vi.unstubAllGlobals()
  await closeDb()
  await new Promise<void>(resolve => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve() })
  resetStoreForTests()
  vi.restoreAllMocks()
})

describe("magasin IndexedDB", () => {
  it("enregistre, relit, met à jour et supprime", async () => {
    const store = createIndexedDbStore()
    expect(await store.load()).toEqual([])
    await store.save([conv("a"), conv("b")], [])
    expect((await store.load() as Conversation[]).map(c => c.id).sort()).toEqual(["a", "b"])
    await store.save([conv("a", { title: "nouveau" })], ["b"])
    const rest = await store.load() as Conversation[]
    expect(rest.map(c => [c.id, c.title])).toEqual([["a", "nouveau"]])
  })

  it("conserve la structure complète d'une conversation", async () => {
    const full = conv("a", { model: "m", calib: { tokens: 10, chars: 30 }, summary: { text: "s", notes: ["n"], upTo: 1, messagesCovered: 1, tokensBefore: 5, tokensAfter: 2, createdAt: 1, auto: true } })
    await createIndexedDbStore().save([full], [])
    expect(await createIndexedDbStore().load()).toEqual([full])
  })

  it("dépasse sans problème les 5 Mo de localStorage", async () => {
    const big = "x".repeat(1_000_000)
    const many = Array.from({ length: 8 }, (_, i) => conv(`c${i}`, { messages: [{ role: "user", content: big }] }))
    await createIndexedDbStore().save(many, [])
    expect(await createIndexedDbStore().load()).toHaveLength(8)
  })
})

describe("getStore", () => {
  it("choisit IndexedDB quand il est disponible", async () => {
    expect((await getStore()).kind).toBe("indexeddb")
  })
  it("se replie sur localStorage quand IndexedDB est indisponible", async () => {
    await closeDb()
    vi.stubGlobal("indexedDB", undefined)
    resetStoreForTests()
    expect((await getStore()).kind).toBe("localstorage")
  })
})

describe("magasin localStorage (repli)", () => {
  it("enregistre, relit et supprime", async () => {
    const store = createLocalStorageStore()
    await store.save([conv("a"), conv("b")], [])
    expect(JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY)!)).toHaveLength(2)
    const again = createLocalStorageStore()
    expect(await again.load()).toHaveLength(2)
    await again.save([], ["a"])
    expect((JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY)!) as Conversation[]).map(c => c.id)).toEqual(["b"])
  })
  it("tolère un contenu illisible", async () => {
    localStorage.setItem(LEGACY_HISTORY_KEY, "{pas du json")
    expect(await createLocalStorageStore().load()).toEqual([])
  })
})

describe("loadConversations (migration)", () => {
  it("migre l'ancien historique localStorage vers IndexedDB puis le supprime", async () => {
    localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([conv("a"), conv("b")]))
    const store = createIndexedDbStore()
    const loaded = await loadConversations(store)
    expect(loaded.map(c => c.id)).toEqual(["a", "b"])
    expect(await store.load()).toHaveLength(2)
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull()
  })
  it("ne migre pas quand IndexedDB contient déjà des conversations", async () => {
    const store = createIndexedDbStore()
    await store.save([conv("deja")], [])
    localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([conv("ancien")]))
    expect((await loadConversations(store)).map(c => c.id)).toEqual(["deja"])
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).not.toBeNull()
  })
  it("ne supprime pas l'ancien historique si la copie échoue", async () => {
    localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([conv("a")]))
    const store = createIndexedDbStore()
    vi.spyOn(store, "save").mockRejectedValue(new Error("échec"))
    await expect(loadConversations(store)).rejects.toThrow("échec")
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).not.toBeNull()
  })
  it("répare ce qui est abîmé", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const store = createIndexedDbStore()
    await idbPutRaw(store, [{ id: "r", messages: [{ role: "user", content: "ok" }, { oups: 1 }] }, { sans: "id" }])
    const loaded = await loadConversations(store)
    expect(loaded.map(c => c.id)).toEqual(["r"])
    expect(loaded[0].messages).toHaveLength(1)
  })
  it("ne touche pas au localStorage avec le repli localStorage", async () => {
    localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([conv("a")]))
    expect((await loadConversations(createLocalStorageStore())).map(c => c.id)).toEqual(["a"])
    expect(localStorage.getItem(LEGACY_HISTORY_KEY)).not.toBeNull()
  })
})

// Écrit des objets bruts (même invalides) dans le magasin, pour tester la réparation
async function idbPutRaw(store: ReturnType<typeof createIndexedDbStore>, items: object[]) {
  await store.save(items.filter(i => "id" in i) as Conversation[], [])
}
