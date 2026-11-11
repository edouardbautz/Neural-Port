import type { Conversation } from "../App"
import { idbGetAll, idbWrite, openDb } from "./idb"
import { sanitizeConversations } from "./history"

// ---------------------------------------------------------------------------------------------------------------
// Stockage des conversations.
// IndexedDB en priorité : pas de plafond de 5 Mo, et on n'écrit que les conversations modifiées.
// Repli sur localStorage si IndexedDB est indisponible (navigation privée de certains navigateurs…).
// ---------------------------------------------------------------------------------------------------------------

export interface ConversationStore {
  readonly kind: "indexeddb" | "localstorage"
  load(): Promise<unknown[]>                                              // contenu brut, à assainir
  save(changed: Conversation[], removedIds: string[]): Promise<void>
}

export const LEGACY_HISTORY_KEY = "neural-port-history"

export function createIndexedDbStore(): ConversationStore {
  return {
    kind: "indexeddb",
    load: () => idbGetAll<unknown>(),
    save: (changed, removedIds) => idbWrite(changed, removedIds)
  }
}

// Ancien format : tout l'historique dans une seule clé localStorage
function readLegacy(): unknown[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) ?? "null")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function createLocalStorageStore(): ConversationStore {
  let all = new Map<string, unknown>()
  return {
    kind: "localstorage",
    async load() {
      const items = readLegacy()
      all = new Map(items.filter((c): c is { id: string } => !!c && typeof (c as { id?: unknown }).id === "string").map(c => [c.id, c]))
      return items
    },
    async save(changed, removedIds) {
      for (const c of changed) all.set(c.id, c)
      for (const id of removedIds) all.delete(id)
      localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([...all.values()]))
    }
  }
}

let storePromise: Promise<ConversationStore> | null = null

// Le magasin à utiliser : IndexedDB si on peut l'ouvrir, sinon localStorage
export function getStore(): Promise<ConversationStore> {
  storePromise ??= openDb().then(
    () => createIndexedDbStore(),
    () => createLocalStorageStore()
  )
  return storePromise
}

export function resetStoreForTests() {
  storePromise = null
}

// Lit les conversations. Ce qui est récupérable est gardé (voir sanitizeConversations).
// Premier lancement avec IndexedDB : l'ancien historique localStorage est migré, puis supprimé une fois copié.
export async function loadConversations(store: ConversationStore): Promise<Conversation[]> {
  let raw = await store.load()
  if (raw.length === 0 && store.kind === "indexeddb") {
    const legacy = readLegacy()
    if (legacy.length > 0) {
      const { conversations } = sanitizeConversations(legacy)
      await store.save(conversations, [])
      try {
        localStorage.removeItem(LEGACY_HISTORY_KEY)
      } catch {
        // ignoré : la copie est faite, l'ancienne sera simplement ignorée
      }
      raw = conversations
    }
  }
  const { conversations, repaired, skipped } = sanitizeConversations(raw)
  if (repaired > 0 || skipped > 0) console.warn(`Historique : ${repaired} conversation(s) réparée(s), ${skipped} élément(s) inutilisable(s) ignoré(s)`)
  return conversations
}
