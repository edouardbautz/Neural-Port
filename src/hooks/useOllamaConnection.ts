import { useCallback, useEffect, useRef, useState } from "react"
import { fetchModelNames, getOllamaUrl } from "../lib/ollama"

export type Connection = "checking" | "ok" | "down"
export const RECONNECT_DELAY_MS = 5000

// État de la connexion à Ollama et liste de ses modèles.
// Quand Ollama ne répond pas, on réessaie régulièrement : l'interface se rétablit toute seule dès qu'il revient.
// `onModels` est appelé à chaque liste reçue (par exemple pour vérifier que le modèle mémorisé existe toujours).
export function useOllamaConnection(ollamaUrl: string, onModels: (names: string[]) => void) {
  const [modelList, setModelList] = useState<string[]>([])
  const [connection, setConnection] = useState<Connection>("checking")
  const [retrying, setRetrying] = useState(false)
  const onModelsRef = useRef(onModels)
  useEffect(() => {
    onModelsRef.current = onModels
  })

  const refresh = useCallback(async (): Promise<boolean> => {
    const url = getOllamaUrl()
    try {
      const names = await fetchModelNames(url)
      if (url !== getOllamaUrl()) return false // l'adresse a changé pendant la requête
      setModelList(names)
      onModelsRef.current(names)
      setConnection("ok")
      return true
    } catch (error) {
      if (url !== getOllamaUrl()) return false
      console.error("Impossible de contacter Ollama:", error)
      setConnection("down")
      return false
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timer)
  }, [ollamaUrl, refresh])

  useEffect(() => {
    if (connection !== "down") return
    const id = setInterval(() => void refresh(), RECONNECT_DELAY_MS)
    return () => clearInterval(id)
  }, [connection, ollamaUrl, refresh])

  const retry = useCallback(async () => {
    setRetrying(true)
    await refresh()
    setRetrying(false)
  }, [refresh])

  // Avant de changer d'adresse : on oublie la liste de l'ancien serveur
  const reset = useCallback(() => {
    setModelList([])
    setConnection("checking")
  }, [])

  return { modelList, connection, retrying, refresh, retry, reset }
}
