import { useCallback, useEffect, useRef, useState } from "react"
import type { Conversation } from "../App"
import { getStore, loadConversations, type ConversationStore } from "../lib/conversationStore"

// `conversations` change à chaque fragment de texte pendant le streaming : l'écriture est différée
export const SAVE_DELAY_MS = 400

// Historique des conversations, mémorisé dans le navigateur (IndexedDB).
// - `ready` : la lecture initiale est terminée (avant, la liste est vide et rien n'est écrit)
// - Seules les conversations modifiées (ou supprimées) sont écrites : un onglet ne peut pas écraser celles d'un autre.
export function useHistory(storeSource?: Promise<ConversationStore> | ConversationStore) {
  const [source] = useState(() => storeSource ?? getStore())
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [ready, setReady] = useState(false)
  const [storageFull, setStorageFull] = useState(false)
  const store = useRef<ConversationStore | null>(null)
  const latest = useRef<Conversation[]>([])
  const persisted = useRef(new Map<string, Conversation>()) // ce qui est déjà enregistré (par référence)
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const opened = await source
      const loaded = await loadConversations(opened)
      if (cancelled) return
      store.current = opened
      persisted.current = new Map(loaded.map(c => [c.id, c]))
      latest.current = loaded
      setConversations(loaded)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [source])

  // Les écritures s'enchaînent une par une : la suivante part de ce que la précédente a réellement enregistré
  const save = useCallback((): Promise<void> => {
    queue.current = queue.current.then(async () => {
      const target = store.current
      if (!target) return
      const current = latest.current
      const ids = new Set(current.map(c => c.id))
      const changed = current.filter(c => persisted.current.get(c.id) !== c)
      const removed = [...persisted.current.keys()].filter(id => !ids.has(id))
      if (changed.length === 0 && removed.length === 0) return
      try {
        await target.save(changed, removed)
        for (const c of changed) persisted.current.set(c.id, c)
        for (const id of removed) persisted.current.delete(id)
        setStorageFull(false)
      } catch {
        // Stockage plein ou bloqué : on le signale (bandeau) pour que l'utilisateur puisse exporter avant de tout perdre.
        // Rien n'est marqué comme enregistré : la prochaine modification retentera.
        setStorageFull(true)
      }
    })
    return queue.current
  }, [])

  useEffect(() => {
    latest.current = conversations
    if (!ready) return
    const timer = setTimeout(() => void save(), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [conversations, ready, save])

  // Page masquée ou fermée : on n'attend pas le délai
  useEffect(() => {
    const flush = () => void save()
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush()
    }
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [save])

  // Valeur la plus récente, lisible depuis un gestionnaire d'événements sans attendre un nouveau rendu
  const getConversations = useCallback(() => latest.current, [])

  return { conversations, setConversations, storageFull, getConversations, ready }
}
