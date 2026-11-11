// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_OLLAMA_URL, setOllamaUrl } from "../lib/ollama"
import { RECONNECT_DELAY_MS, useOllamaConnection } from "./useOllamaConnection"

const ok = (models: string[]) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ models: models.map(name => ({ name })) }) } as Response)
const fail = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"))

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "error").mockImplementation(() => {})
  setOllamaUrl("http://h:1")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setOllamaUrl(DEFAULT_OLLAMA_URL)
})

// Laisse s'exécuter le minuteur de démarrage et les promesses qui en découlent
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(10) })

describe("useOllamaConnection", () => {
  it("charge les modèles au démarrage et prévient onModels", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok(["a", "b"])))
    const onModels = vi.fn()
    const { result } = renderHook(() => useOllamaConnection("http://h:1", onModels))
    expect(result.current.connection).toBe("checking")
    await settle()
    expect(result.current.connection).toBe("ok")
    expect(result.current.modelList).toEqual(["a", "b"])
    expect(onModels).toHaveBeenCalledWith(["a", "b"])
  })

  it("passe en « injoignable » puis se rétablit tout seul quand Ollama revient", async () => {
    const fetchMock = vi.fn(fail)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useOllamaConnection("http://h:1", () => {}))
    await settle()
    expect(result.current.connection).toBe("down")
    fetchMock.mockImplementation(() => ok(["m"]))
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS + 10) })
    expect(result.current.connection).toBe("ok")
    expect(result.current.modelList).toEqual(["m"])
  })

  it("ne réessaie pas tant que la connexion est bonne", async () => {
    const fetchMock = vi.fn(() => ok(["a"]))
    vi.stubGlobal("fetch", fetchMock)
    renderHook(() => useOllamaConnection("http://h:1", () => {}))
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS * 3) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retry : indique la tentative en cours puis le résultat", async () => {
    const fetchMock = vi.fn(fail)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useOllamaConnection("http://h:1", () => {}))
    await settle()
    fetchMock.mockImplementation(() => ok(["n"]))
    await act(async () => { await result.current.retry() })
    expect(result.current.retrying).toBe(false)
    expect(result.current.connection).toBe("ok")
  })

  it("refresh renvoie false sans lever d'erreur quand Ollama ne répond pas", async () => {
    vi.stubGlobal("fetch", vi.fn(fail))
    const { result } = renderHook(() => useOllamaConnection("http://h:1", () => {}))
    await settle()
    let value = true
    await act(async () => { value = await result.current.refresh() })
    expect(value).toBe(false)
  })

  it("ignore la réponse d'un ancien serveur quand l'adresse a changé entre-temps", async () => {
    let release: (r: Response) => void = () => {}
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { release = resolve })))
    const onModels = vi.fn()
    const { result } = renderHook(() => useOllamaConnection("http://h:1", onModels))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    setOllamaUrl("http://autre:2")
    await act(async () => { release(await ok(["ancien"])) })
    expect(onModels).not.toHaveBeenCalled()
    expect(result.current.modelList).toEqual([])
    expect(result.current.connection).toBe("checking")
  })

  it("reset efface la liste et repasse en vérification", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok(["a"])))
    const { result } = renderHook(() => useOllamaConnection("http://h:1", () => {}))
    await settle()
    act(() => { result.current.reset() })
    expect(result.current.modelList).toEqual([])
    expect(result.current.connection).toBe("checking")
  })

  it("recharge quand l'adresse change", async () => {
    const fetchMock = vi.fn(() => ok(["a"]))
    vi.stubGlobal("fetch", fetchMock)
    const { rerender } = renderHook(({ url }) => useOllamaConnection(url, () => {}), { initialProps: { url: "http://h:1" } })
    await settle()
    setOllamaUrl("http://autre:2")
    rerender({ url: "http://autre:2" })
    await settle()
    expect(fetchMock).toHaveBeenLastCalledWith("http://autre:2/api/tags")
  })
})
