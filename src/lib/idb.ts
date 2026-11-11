// Petit enveloppeur IndexedDB (sans dépendance) : une base, un magasin de conversations indexées par `id`.

export const DB_NAME = "neural-port"
export const CONVERSATIONS_STORE = "conversations"
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Erreur IndexedDB"))
  })
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB indisponible"))
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        request.result.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // Une autre version de l'application veut mettre la base à jour : on libère la connexion
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error("Ouverture d'IndexedDB impossible"))
    request.onblocked = () => reject(new Error("Ouverture d'IndexedDB bloquée"))
  }).catch(error => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

// Ferme la connexion (tests, ou avant de supprimer la base)
export async function closeDb() {
  if (!dbPromise) return
  const db = await dbPromise.catch(() => null)
  db?.close()
  dbPromise = null
}

export async function idbGetAll<T>(): Promise<T[]> {
  const db = await openDb()
  return requestResult<T[]>(db.transaction(CONVERSATIONS_STORE, "readonly").objectStore(CONVERSATIONS_STORE).getAll())
}

// Écrit et supprime dans une seule transaction : tout est enregistré, ou rien
export async function idbWrite(put: unknown[], removeIds: string[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE, "readwrite")
    const store = tx.objectStore(CONVERSATIONS_STORE)
    for (const item of put) store.put(item)
    for (const id of removeIds) store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("Écriture IndexedDB impossible"))
    tx.onabort = () => reject(tx.error ?? new Error("Écriture IndexedDB annulée"))
  })
}
