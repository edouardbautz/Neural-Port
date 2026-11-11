// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Conversation } from "../App"
import type { ConversationStore } from "../lib/conversationStore"
import { SAVE_DELAY_MS, useHistory } from "./useHistory"

const conv = (id: string, content = "a"): Conversation => ({
  id, title: id, createdAt: 1, updatedAt: 2, messages: [{ role: "user", content }, { role: "assistant", content: "b" }]
})

// Magasin en mémoire qui enregistre ce qu'on lui demande d'écrire
function fakeStore(initial: unknown[] = []) {
  const data = new Map<string, unknown>(initial.map(c => [(c as Conversation).id, c]))
  const store = {
    kind: "indexeddb" as const,
    load: vi.fn(() => Promise.resolve([...data.values()])),
    save: vi.fn((changed: Conversation[], removedIds: string[]) => {
      for (const c of changed) data.set(c.id, c)
      for (const id of removedIds) data.delete(id)
      return Promise.resolve()
    })
  } satisfies ConversationStore
  return { store, data }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function loaded(store: ConversationStore) {
  const hook = renderHook(() => useHistory(store))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return hook
}
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe("useHistory", () => {
  it("charge l'historique puis devient prêt", async () => {
    const { store } = fakeStore([conv("a"), conv("b")])
    const hook = renderHook(() => useHistory(store))
    expect(hook.result.current.ready).toBe(false)
    expect(hook.result.current.conversations).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.ready).toBe(true)
    expect(hook.result.current.conversations.map(c => c.id)).toEqual(["a", "b"])
  })

  it("répare au lieu de jeter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { store } = fakeStore([conv("a"), { id: "b", messages: [{ role: "user", content: "ok" }, { oups: 1 }] }, 42])
    const { result } = await loaded(store)
    expect(result.current.conversations.map(c => c.id)).toEqual(["a", "b"])
    expect(result.current.conversations[1].messages).toHaveLength(1)
  })

  it("n'écrit rien tant que rien n'a changé (ne pas écraser un autre onglet)", async () => {
    const { store } = fakeStore([conv("a")])
    await loaded(store)
    await wait(SAVE_DELAY_MS * 3)
    window.dispatchEvent(new Event("pagehide"))
    await wait(0)
    expect(store.save).not.toHaveBeenCalled()
  })

  it("n'écrit que la conversation modifiée, une seule fois pour une rafale de modifications", async () => {
    const { store, data } = fakeStore([conv("a"), conv("b")])
    const { result } = await loaded(store)
    for (let i = 0; i < 5; i++) {
      act(() => { result.current.setConversations(prev => prev.map(c => (c.id === "b" ? { ...c, title: `t${i}` } : c))) })
      await wait(SAVE_DELAY_MS / 2)
    }
    expect(store.save).not.toHaveBeenCalled()
    await wait(SAVE_DELAY_MS)
    expect(store.save).toHaveBeenCalledTimes(1)
    const [changed, removed] = store.save.mock.calls[0]
    expect(changed.map(c => c.id)).toEqual(["b"])
    expect(removed).toEqual([])
    expect((data.get("b") as Conversation).title).toBe("t4")
  })

  it("enregistre les ajouts et les suppressions", async () => {
    const { store, data } = fakeStore([conv("a"), conv("b")])
    const { result } = await loaded(store)
    act(() => { result.current.setConversations(prev => [conv("c"), ...prev.filter(c => c.id !== "a")]) })
    await wait(SAVE_DELAY_MS)
    expect(store.save).toHaveBeenCalledWith([expect.objectContaining({ id: "c" })], ["a"])
    expect([...data.keys()].sort()).toEqual(["b", "c"])
  })

  it("écrit tout de suite quand la page est masquée ou fermée", async () => {
    const { store } = fakeStore()
    const { result } = await loaded(store)
    act(() => { result.current.setConversations([conv("x")]) })
    expect(store.save).not.toHaveBeenCalled()
    window.dispatchEvent(new Event("pagehide"))
    await wait(0)
    expect(store.save).toHaveBeenCalledTimes(1)

    act(() => { result.current.setConversations(prev => [...prev, conv("y")]) })
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
    await wait(0)
    expect(store.save).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
  })

  it("signale un stockage plein, puis réessaie et se rétablit", async () => {
    const { store, data } = fakeStore()
    const { result } = await loaded(store)
    store.save.mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"))
    act(() => { result.current.setConversations([conv("x")]) })
    await wait(SAVE_DELAY_MS)
    expect(result.current.storageFull).toBe(true)
    expect(data.size).toBe(0)
    // La conversation n'a pas été marquée comme enregistrée : elle part avec la modification suivante
    act(() => { result.current.setConversations(prev => [...prev, conv("y")]) })
    await wait(SAVE_DELAY_MS)
    expect(result.current.storageFull).toBe(false)
    expect([...data.keys()].sort()).toEqual(["x", "y"])
  })

  it("enchaîne les écritures sans les faire se chevaucher", async () => {
    const { store } = fakeStore()
    const { result } = await loaded(store)
    let running = 0, maxRunning = 0
    store.save.mockImplementation(async () => {
      running++; maxRunning = Math.max(maxRunning, running)
      await new Promise(r => setTimeout(r, 300))
      running--
    })
    act(() => { result.current.setConversations([conv("a")]) })
    window.dispatchEvent(new Event("pagehide"))
    act(() => { result.current.setConversations([conv("a"), conv("b")]) })
    window.dispatchEvent(new Event("pagehide"))
    await wait(2000)
    expect(maxRunning).toBe(1)
  })

  it("getConversations renvoie la valeur la plus récente", async () => {
    const { store } = fakeStore()
    const { result } = await loaded(store)
    act(() => { result.current.setConversations([conv("z")]) })
    expect(result.current.getConversations().map(c => c.id)).toEqual(["z"])
  })
})
