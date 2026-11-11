import { useCallback, useEffect, useRef, useState } from "react"
import type { Conversation } from "../App"
import { sanitizeConversations } from "../lib/history"

export const HISTORY_KEY = "neural-port-history"
// `conversations` change à chaque fragment de texte pendant le streaming : l'écriture est différée
export const SAVE_DELAY_MS = 400

// Lit l'historique mémorisé. Ce qui est récupérable est gardé ; un stockage illisible donne un historique vide.
export function loadHistory(): Conversation[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) {
      const { conversations, repaired, skipped } = sanitizeConversations(JSON.parse(raw))
      if (repaired > 0 || skipped > 0) console.warn(`Historique : ${repaired} conversation(s) réparée(s), ${skipped} élément(s) inutilisable(s) ignoré(s)`)
      return conversations
    }
  } catch {
    // Historique corrompu ou stockage indisponible : on repart de zéro
  }
  return []
}

// Historique des conversations, mémorisé dans le navigateur.
// Seul un onglet qui a modifié l'historique l'écrit : sinon, il écraserait celui d'un autre onglet.
export function useHistory() {
  const [conversations, setConversations] = useState<Conversation[]>(loadHistory)
  const [storageFull, setStorageFull] = useState(false)
  const latest = useRef(conversations)
  const dirty = useRef(false)
  const loaded = useRef(conversations) // état lu au démarrage : tant qu'il n'a pas changé, rien à écrire

  const save = useCallback(() => {
    if (!dirty.current) return
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(latest.current))
      dirty.current = false
      setStorageFull(false)
    } catch {
      // Stockage plein ou bloqué : on le signale (bandeau) pour que l'utilisateur puisse exporter avant de tout perdre
      setStorageFull(true)
    }
  }, [])

  useEffect(() => {
    latest.current = conversations
    if (conversations === loaded.current) return
    dirty.current = true
    const timer = setTimeout(save, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [conversations, save])

  // Fermeture de la page : on écrit tout de suite ce qui n'a pas encore été écrit
  useEffect(() => {
    window.addEventListener("pagehide", save)
    return () => window.removeEventListener("pagehide", save)
  }, [save])

  // Valeur la plus récente, lisible depuis un gestionnaire d'événements sans attendre un nouveau rendu
  const getConversations = useCallback(() => latest.current, [])

  return { conversations, setConversations, storageFull, getConversations }
}
