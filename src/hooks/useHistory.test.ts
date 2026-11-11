// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Conversation } from "../App"
import { HISTORY_KEY, loadHistory, SAVE_DELAY_MS, useHistory } from "./useHistory"

const conv = (id: string): Conversation => ({
  id, title: id, createdAt: 1, updatedAt: 2, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }]
})
const stored = () => JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "null") as Conversation[] | null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("loadHistory", () => {
  it("renvoie un historique vide sans rien en mémoire", () => {
    expect(loadHistory()).toEqual([])
  })
  it("répare au lieu de jeter", () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([conv("a"), { id: "b", messages: [{ role: "user", content: "ok" }, { oups: 1 }] }, 42]))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const loaded = loadHistory()
    expect(loaded.map(c => c.id)).toEqual(["a", "b"])
    expect(loaded[1].messages).toHaveLength(1)
  })
  it("repart de zéro si le contenu n'est pas du JSON", () => {
    localStorage.setItem(HISTORY_KEY, "{pas du json")
    expect(loadHistory()).toEqual([])
  })
})

describe("useHistory", () => {
  it("n'écrit rien tant que l'historique n'a pas été modifié (ne pas écraser un autre onglet)", () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([conv("a")]))
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    renderHook(() => useHistory())
    act(() => { vi.advanceTimersByTime(SAVE_DELAY_MS * 3) })
    window.dispatchEvent(new Event("pagehide"))
    expect(setItem).not.toHaveBeenCalled()
  })

  it("écrit après le délai, une seule fois pour une rafale de modifications", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    const { result } = renderHook(() => useHistory())
    for (let i = 0; i < 5; i++) {
      act(() => { result.current.setConversations(prev => [...prev, conv(`c${i}`)]) })
      act(() => { vi.advanceTimersByTime(SAVE_DELAY_MS / 2) })
    }
    expect(setItem).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(SAVE_DELAY_MS) })
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(stored()?.map(c => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4"])
  })

  it("écrit immédiatement à la fermeture de la page", () => {
    const { result } = renderHook(() => useHistory())
    act(() => { result.current.setConversations([conv("x")]) })
    expect(stored()).toBeNull()
    window.dispatchEvent(new Event("pagehide"))
    expect(stored()?.map(c => c.id)).toEqual(["x"])
  })

  it("signale un stockage plein, puis se rétablit", () => {
    const real = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError") })
    const { result } = renderHook(() => useHistory())
    act(() => { result.current.setConversations([conv("x")]) })
    act(() => { vi.advanceTimersByTime(SAVE_DELAY_MS) })
    expect(result.current.storageFull).toBe(true)
    setItem.mockImplementation(real)
    act(() => { result.current.setConversations(prev => [...prev, conv("y")]) })
    act(() => { vi.advanceTimersByTime(SAVE_DELAY_MS) })
    expect(result.current.storageFull).toBe(false)
    expect(stored()?.map(c => c.id)).toEqual(["x", "y"])
  })

  it("getConversations renvoie la valeur la plus récente", () => {
    const { result } = renderHook(() => useHistory())
    act(() => { result.current.setConversations([conv("z")]) })
    expect(result.current.getConversations().map(c => c.id)).toEqual(["z"])
  })
})
