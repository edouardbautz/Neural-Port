import { useEffect, useMemo, useRef, useState } from 'react'
import Popup from './components/Popup'
import Msg from './components/Msg'
import Sidebar from './components/Sidebar'
import FilesPanel from './components/FilesPanel'
import SettingsPanel from './components/SettingsPanel'
import { ctxSteps } from './lib/context'
import { repairFences } from './lib/markdown'
import { extensionFor, extractCodeBlocks, filenameFromRequest, makeFile, type GeneratedFile } from './lib/files'
import { MenuIcon, SlidersIcon } from './components/icons'

const OLLAMA_URL = "http://localhost:11434"

export interface Message {
  role: "user" | "assistant"
  content: string
  tps?: number       // tokens/seconde (valeur réelle renvoyée par Ollama)
  duration?: number  // durée de génération en secondes (valeur réelle)
  tokens?: number    // nombre de tokens générés (valeur réelle)
  notice?: boolean   // message d'information de l'appli (erreur…), non envoyé au modèle
  thinking?: string  // réflexion du modèle (affichée dans un bloc repliable)
  ctxUsed?: number   // tokens de contexte utilisés (prompt + génération), renvoyés par Ollama
  files?: GeneratedFile[]  // fichiers créés par l'IA (outil create_file) ou depuis un bloc de code
}

export interface OllamaModelResponse {
  models: {
    name: string
    model: string
  }[]
}

export interface Conversation {
  id: string
  title: string
  model?: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

const HISTORY_KEY = "neural-port-history"
const CTX_KEY = "neural-port-ctx"
const MODEL_KEY = "neural-port-model"
const THINK_KEY = "neural-port-think"
const DEFAULT_CTX = 16384
const ACTIVE_KEY = "neural-port-active"

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

async function checkModelLoaded(model: string): Promise<boolean> {
  try {
    const ps = await fetch(`${OLLAMA_URL}/api/ps`)
    const data = (await ps.json()) as { models?: { name: string }[] }
    return data.models?.some(m => m.name === model) ?? false
  } catch {
    return false
  }
}

const FILE_REQUEST = /fichier|file\b|télécharg|telecharg|download|exporte|\.[a-z]{1,5}\b/i

const SYSTEM_PROMPT =
  "Tu disposes de l'outil create_file, qui crée un fichier téléchargeable pour l'utilisateur. " +
  "Utilise-le pour livrer le fichier demandé, avec son contenu complet et exact."

const CREATE_FILE_TOOL = {
  type: "function",
  function: {
    name: "create_file",
    description: "Crée un fichier téléchargeable. À n'utiliser que si l'utilisateur a demandé un fichier.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Nom du fichier avec son extension, ex: main.py" },
        content: { type: "string", description: "Contenu complet du fichier" }
      },
      required: ["filename", "content"]
    }
  }
}

// Capacités du modèle (Ollama refuse `tools` s'il ne le gère pas) et sa fenêtre de contexte maximale
interface ModelInfo { tools: boolean; thinking: boolean; maxCtx: number | null }
const modelInfoCache = new Map<string, ModelInfo>()
async function getModelInfo(model: string): Promise<ModelInfo> {
  const cached = modelInfoCache.get(model)
  if (cached) return cached
  try {
    const res = await fetch(`${OLLAMA_URL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model })
    })
    const data = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown> }
    const key = Object.keys(data.model_info ?? {}).find(k => k.endsWith(".context_length"))
    const max = key ? data.model_info![key] : null
    const info: ModelInfo = {
      tools: data.capabilities?.includes("tools") ?? false,
      thinking: data.capabilities?.includes("thinking") ?? false,
      maxCtx: typeof max === "number" ? max : null
    }
    modelInfoCache.set(model, info)
    return info
  } catch {
    return { tools: false, thinking: false, maxCtx: null }
  }
}

function SunIcon() {
  return (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function App() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('neural-port-theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [numCtx, setNumCtx] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(CTX_KEY))
      if (saved > 0) return saved
    } catch {
      // ignore
    }
    return DEFAULT_CTX
  })
  const [maxCtx, setMaxCtx] = useState<number | null>(null)
  const [thinkEnabled, setThinkEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THINK_KEY) !== "off"
    } catch {
      return true
    }
  })
  const [liveThinking, setLiveThinking] = useState("")
  const thinkBufferRef = useRef("")
  const [activeModel, setActiveModel] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(MODEL_KEY) ?? undefined
    } catch {
      return undefined
    }
  })
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [inputValue, setInputValue] = useState("")
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Conversation[]
        if (Array.isArray(parsed)) return parsed
      }
    } catch {
      // Historique corrompu ou stockage indisponible : on repart de zéro
    }
    return []
  })
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY)
    } catch {
      return null
    }
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState("")
  const rawBufferRef = useRef("")
  const hasAssistantMsgRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isThinkingRef = useRef(false)
  const thinkOpenIdxRef = useRef(-1)
  const thinkCloseIdxRef = useRef(-1)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [modelList, setModelList] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Conversation active (ou aucune) — les messages affichés en dérivent
  const activeConv = conversations.find(c => c.id === activeId) ?? null
  const messages = useMemo(() => activeConv?.messages ?? [], [activeConv])

  // Fichiers générés (outil create_file ou bouton sur un bloc de code). Le panneau se rouvre quand un nouveau fichier est prêt.
  const files = useMemo(() => messages.flatMap(m => m.files ?? []), [messages])
  const [panelClosed, setPanelClosed] = useState<{ id: string | null; count: number }>({ id: null, count: 0 })
  const panelOpen = files.length > 0 && !(panelClosed.id === activeId && panelClosed.count === files.length)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('neural-port-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  // Persistance de l'historique et de la conversation active
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(conversations))
    } catch {
      // Stockage plein ou bloqué : l'historique ne sera simplement pas conservé
    }
  }, [conversations])

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
      else localStorage.removeItem(ACTIVE_KEY)
    } catch {
      // ignore
    }
  }, [activeId])

  useEffect(() => {
    if (!isAtBottom) return
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
  }, [messages, isAtBottom, isLoading, isThinking])

  useEffect(() => {
    try {
      localStorage.setItem(THINK_KEY, thinkEnabled ? "auto" : "off")
    } catch {
      // ignore
    }
  }, [thinkEnabled])

  useEffect(() => {
    try {
      localStorage.setItem(CTX_KEY, String(numCtx))
    } catch {
      // ignore
    }
  }, [numCtx])

  useEffect(() => {
    try {
      if (activeModel) localStorage.setItem(MODEL_KEY, activeModel)
      else localStorage.removeItem(MODEL_KEY)
    } catch {
      // ignore
    }
  }, [activeModel])

  // Contexte réellement demandé à Ollama : le préchargement et le chat doivent utiliser la même valeur,
  // sinon Ollama recharge le modèle au premier message
  const effectiveCtx = Math.min(numCtx, ctxSteps(maxCtx).at(-1)!)

  // Précharge le modèle dès sa sélection (ou quand la fenêtre de contexte change), pour pouvoir écrire tout de suite
  useEffect(() => {
    if (!activeModel || modelList.length === 0) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setModelStatus("loading")
      try {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: activeModel, prompt: "", stream: false, options: { num_ctx: effectiveCtx } }),
          signal: controller.signal
        })
        if (!controller.signal.aborted) setModelStatus(res.ok ? "ready" : "error")
      } catch {
        if (!controller.signal.aborted) setModelStatus("error")
      }
    }, 400) // le curseur de contexte envoie beaucoup de valeurs : on attend qu'il se stabilise
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [activeModel, effectiveCtx, modelList.length])

  // Ollama décharge le modèle après quelques minutes d'inactivité : on garde le voyant à jour
  useEffect(() => {
    if (!activeModel) return
    const id = setInterval(async () => {
      const loaded = await checkModelLoaded(activeModel)
      setModelStatus(prev => (prev === "ready" && !loaded ? "idle" : prev === "idle" && loaded ? "ready" : prev))
    }, 10000)
    return () => clearInterval(id)
  }, [activeModel])

  // Contexte maximal du modèle sélectionné (borne du curseur)
  useEffect(() => {
    if (!activeModel) return
    let cancelled = false
    getModelInfo(activeModel).then(info => {
      if (!cancelled) setMaxCtx(info.maxCtx)
    })
    return () => { cancelled = true }
  }, [activeModel])

  // Échap arrête la génération en cours
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") abortRef.current?.abort()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Renvoie le curseur dans l'input dès qu'il est utilisable :
  // à l'arrivée sur la page, au choix d'un modèle, et à la fin de chaque réponse
  useEffect(() => {
    if (!isLoading && !isStreaming && activeModel) {
      textareaRef.current?.focus()
    }
  }, [isLoading, isStreaming, activeModel])

  useEffect(() => {
    async function fetchModels() {
      try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`)
        const data = (await response.json()) as OllamaModelResponse
        const names = data.models.map(model => model.name)
        setModelList(names)
        // Le modèle mémorisé a pu être supprimé entre-temps
        setActiveModel(current => (current && names.includes(current) ? current : undefined))
      } catch (error) {
        console.error("Impossible de contacter Ollama:", error)
      }
    }
    fetchModels()
  }, [])

  function handleWheel(event: React.WheelEvent) {
    const container = scrollContainerRef.current
    if (event.deltaY < 0) {
      setIsAtBottom(false)
    } else if (container && container.scrollHeight - container.scrollTop - container.clientHeight < 30) {
      setIsAtBottom(true)
    }
  }

  function scrollToBottom() {
    setIsAtBottom(true)
  }

  function handleTextareaChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(event.target.value)
    const textarea = event.target
    textarea.style.height = 'auto'
    textarea.style.height = textarea.scrollHeight + 'px'
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  function updateConversation(id: string, fn: (c: Conversation) => Conversation) {
    setConversations(prev => prev.map(c => (c.id === id ? { ...fn(c), updatedAt: Date.now() } : c)))
  }

  function updateMessages(convId: string, fn: (msgs: Message[]) => Message[]) {
    updateConversation(convId, c => ({ ...c, messages: fn(c.messages) }))
  }

  // Ajoute un fichier au message d'indice msgIndex (le crée s'il n'existe pas déjà dans la conversation)
  function addFile(convId: string, msgIndex: number, name: string, content: string, lang: string | null) {
    updateConversation(convId, c => {
      const all = c.messages.flatMap(m => m.files ?? [])
      if (c.messages[msgIndex]?.files?.some(f => f.content.trim() === content.trim())) return c
      const file = makeFile(name, content, lang, all)
      return {
        ...c,
        messages: c.messages.map((m, i) => (i === msgIndex ? { ...m, files: [...(m.files ?? []), file] } : m)),
      }
    })
  }

  function saveCodeAsFile(msgIndex: number, code: string, lang: string | null) {
    if (!activeConv) return
    addFile(activeConv.id, msgIndex, `code-${(activeConv?.messages.flatMap(m => m.files ?? []).length ?? 0) + 1}.${extensionFor(lang)}`, code, lang)
  }

  // Affiche un message d'information à la place d'une bulle vide (erreur, absence de réponse…)
  function addNotice(convId: string, text: string) {
    updateConversation(convId, c => {
      const last = c.messages[c.messages.length - 1]
      const empty = last?.role === "assistant" && !last.content.trim() && !last.files?.length
      const base = empty ? c.messages.slice(0, -1) : c.messages
      return { ...c, messages: [...base, { role: "assistant", content: text, notice: true }] }
    })
  }

  // Régénère la dernière réponse (supprime la réponse actuelle et pose de nouveau la dernière question)
  function regenerate() {
    if (!activeConv || busy) return
    const lastUser = activeConv.messages.map(m => m.role).lastIndexOf("user")
    if (lastUser === -1) return
    const thread = activeConv.messages.slice(0, lastUser + 1)
    updateMessages(activeConv.id, () => thread)
    void generate(activeConv.id, thread)
  }

  // Modifie un message de l'utilisateur : la conversation repart de ce point
  function editMessage(index: number, content: string) {
    if (!activeConv || busy || !content.trim()) return
    const thread: Message[] = [...activeConv.messages.slice(0, index), { role: "user", content }]
    updateMessages(activeConv.id, () => thread)
    void generate(activeConv.id, thread)
  }

  // Rattache la réflexion du modèle à sa réponse pour pouvoir la relire
  function commitThinking(convId: string) {
    const text = thinkBufferRef.current.trim()
    if (!text || !hasAssistantMsgRef.current) return
    updateMessages(convId, msgs => {
      const last = msgs[msgs.length - 1]
      if (!last || last.role !== "assistant") return msgs
      return [...msgs.slice(0, -1), { ...last, thinking: text }]
    })
  }

  // Interrompt la génération en cours : le texte déjà écrit est conservé
  function stopGeneration() {
    abortRef.current?.abort()
  }

  function newConversation() {
    if (isLoading || isStreaming) return
    setActiveId(null)
    setSidebarOpen(false)
  }

  function openConversation(id: string) {
    if (isLoading || isStreaming) return
    setActiveId(id)
    setIsAtBottom(true)
    setSidebarOpen(false)
  }

  function deleteConversation(id: string) {
    if (!window.confirm("Supprimer cette conversation ?")) return
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) setActiveId(null)
  }

  async function sendMessage() {
    if (!inputValue.trim() || isLoading || isStreaming) return

    const userMessage: Message = { role: "user", content: inputValue }

    // Soit on rattachera le message à la conversation en cours, soit on en crée une
    let convId = activeConv ? activeConv.id : null
    if (!convId) {
      convId = makeId()
      const text = inputValue.trim().replace(/\s+/g, " ")
      const title = text.length > 50 ? text.slice(0, 50).trimEnd() + "…" : text
      const now = Date.now()
      const id = convId
      setConversations(prev => [
        { id, title, model: activeModel, messages: [userMessage], createdAt: now, updatedAt: now },
        ...prev
      ])
      setActiveId(id)
    } else {
      updateMessages(convId, msgs => [...msgs, userMessage])
    }

    setInputValue("")
    await generate(convId, [...(activeConv?.messages ?? []), userMessage])
  }

  // Demande une réponse au modèle pour la conversation `thread` (qui se termine par un message utilisateur)
  async function generate(convId: string, thread: Message[]) {
    const userMessage = [...thread].reverse().find(m => m.role === "user")!
    setIsAtBottom(true)

    const modelAlreadyLoaded = await checkModelLoaded(activeModel!)
    setLoadingMessage(modelAlreadyLoaded ? "Traitement du contexte…" : "Chargement du modèle…")
    setIsLoading(true)

    if (!modelAlreadyLoaded) {
      pollingRef.current = setInterval(async () => {
        if (await checkModelLoaded(activeModel!)) {
          setLoadingMessage("Traitement du contexte…")
          clearInterval(pollingRef.current!)
          pollingRef.current = null
        }
      }, 500)
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const controller = new AbortController()
    abortRef.current = controller

    // Nom de fichier cité par l'utilisateur (« crée jeu.py ») : il prime sur celui choisi par le modèle
    const requestedName = filenameFromRequest(userMessage.content)
    let failure: string | null = null  // erreur renvoyée par Ollama pendant le flux

    try {
      // L'outil n'est proposé que si le message parle explicitement d'un fichier : un petit modèle
      // l'appellerait sinon dès qu'on lui demande du code, et réfléchirait longuement à la consigne
      const info = await getModelInfo(activeModel!)
      const useTools = FILE_REQUEST.test(userMessage.content) && info.tools

      // On n'envoie que role/content à Ollama (stats exclues) ; les fichiers créés sont rappelés au modèle
      const history = thread.filter(m => !m.notice).map(m => ({
        role: m.role,
        content: m.files?.length
          ? `${m.content}\n[Fichiers créés : ${m.files.map(f => f.name).join(", ")}]`.trim()
          : m.content
      }))

      // Les modèles « réfléchisseurs » épuisent parfois leur limite de tokens en pensant, sans rien répondre.
      // Dans ce cas on relance une fois, sans réflexion, avant d'abandonner.
      for (let attempt = 0; attempt < 2; attempt++) {
        failure = null
        if (attempt > 0) {
          setLoadingMessage("Nouvelle tentative…")
          setIsLoading(true)
          setIsStreaming(false)
          setIsThinking(false)
          isThinkingRef.current = false
        }

        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: activeModel,
            messages: useTools ? [{ role: "system", content: SYSTEM_PROMPT }, ...history] : history,
            ...(useTools ? { tools: [CREATE_FILE_TOOL] } : {}),
            options: { num_ctx: effectiveCtx },
            // `think` n'est accepté que par les modèles qui savent raisonner
            ...(info.thinking && (attempt > 0 || !thinkEnabled) ? { think: false } : {}),
            stream: true
          }),
          signal: controller.signal
        })

        if (!response.body) throw new Error("Réponse vide du serveur")

        setIsStreaming(true)
        rawBufferRef.current = ""
        thinkBufferRef.current = ""
        setLiveThinking("")
        hasAssistantMsgRef.current = false
        isThinkingRef.current = false
        thinkOpenIdxRef.current = -1
        thinkCloseIdxRef.current = -1

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let firstChunk = true
        let carry = ""  // fin de ligne incomplète (un appel d'outil avec un gros fichier peut être coupé entre deux lectures)

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const parts = (carry + decoder.decode(value, { stream: true })).split('\n')
          carry = parts.pop() ?? ""
          const lines = parts.filter(line => line.trim())

          for (const line of lines) {
            try {
              const chunk = JSON.parse(line) as {
                message?: {
                  content: string
                  thinking?: string
                  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
                }
                error?: string
                done?: boolean
                eval_count?: number
              prompt_eval_count?: number
                eval_duration?: number
              }

              if (chunk.error) failure = chunk.error

              if (chunk.done) {
                // Valeurs réelles renvoyées par Ollama à la fin du stream.
                // On ne les garde que si elles sont présentes : jamais inventées.
                const tokens = chunk.eval_count
              const ctxUsed = (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0)
                const sec = (chunk.eval_duration ?? 0) / 1e9
                if (tokens && tokens > 0 && sec > 0) {
                  updateMessages(convId, prev => {
                    const last = prev[prev.length - 1]
                    if (!last || last.role !== "assistant") return prev
                    const arr = [...prev]
                    arr[arr.length - 1] = { ...last, tps: tokens / sec, duration: sec, tokens, ctxUsed }
                    return arr
                  })
                }
              }

              const hasThinking = !!chunk.message?.thinking
              const hasContent = !!chunk.message?.content
              const toolCalls = chunk.message?.tool_calls ?? []

              if (!hasThinking && !hasContent && toolCalls.length === 0) continue

              if (firstChunk) {
                setIsLoading(false)
                firstChunk = false
              }

              // Appels de l'outil create_file : on ignore tout ce qui est mal formé
              for (const call of toolCalls) {
                const { filename, content } = call.function.arguments ?? {}
                if (call.function.name !== "create_file" || typeof filename !== "string" || typeof content !== "string" || !filename.trim() || !content.trim()) continue
                if (!hasAssistantMsgRef.current) {
                  updateMessages(convId, prev => [...prev, { role: "assistant", content: "" }])
                  hasAssistantMsgRef.current = true
                }
                updateConversation(convId, c => {
                  const idx = c.messages.length - 1
                  const already = c.messages[idx]?.files?.length ?? 0
                  const file = makeFile(already === 0 && requestedName ? requestedName : filename, content, null, c.messages.flatMap(m => m.files ?? []))
                  return { ...c, messages: c.messages.map((m, i) => (i === idx ? { ...m, files: [...(m.files ?? []), file] } : m)) }
                })
              }

              if (hasThinking) {
                thinkBufferRef.current += chunk.message!.thinking
                setLiveThinking(thinkBufferRef.current)
              }

              if (hasThinking && !isThinkingRef.current) {
                isThinkingRef.current = true
                setIsThinking(true)
              }

              if (hasContent) {
                rawBufferRef.current += chunk.message!.content
                const raw = rawBufferRef.current

                if (thinkOpenIdxRef.current === -1)
                  thinkOpenIdxRef.current = raw.indexOf('<think>')
                if (thinkOpenIdxRef.current !== -1 && thinkCloseIdxRef.current === -1)
                  thinkCloseIdxRef.current = raw.indexOf('</think>')

                const thinkOpenIdx = thinkOpenIdxRef.current
                const thinkCloseIdx = thinkCloseIdxRef.current
                const beforeThink = thinkOpenIdx > 0 ? raw.slice(0, thinkOpenIdx) : ''

                let displayContent: string
                let tagThinking: boolean

                if (thinkOpenIdx === -1) {
                  displayContent = raw
                  tagThinking = false
                } else if (thinkCloseIdx === -1) {
                  displayContent = beforeThink
                  tagThinking = true
                } else {
                  displayContent = beforeThink + raw.slice(thinkCloseIdx + '</think>'.length).trimStart()
                  tagThinking = false
                }

                if (!tagThinking && isThinkingRef.current) {
                  isThinkingRef.current = false
                  setIsThinking(false)
                }

                if (displayContent.length > 0) {
                  if (!hasAssistantMsgRef.current) {
                    updateMessages(convId, prev => [...prev, { role: "assistant", content: displayContent }])
                    hasAssistantMsgRef.current = true
                  } else {
                    updateMessages(convId, prev => {
                      const updated = [...prev]
                      updated[updated.length - 1] = { ...updated[updated.length - 1], content: displayContent }
                      return updated
                    })
                  }
                }
              }
            } catch {
              // ignore incomplete JSON chunks
            }
          }
        }

        commitThinking(convId)
        if (hasAssistantMsgRef.current || controller.signal.aborted) break
      }

      // Arrêt demandé par l'utilisateur : on garde ce qui est déjà écrit, sans message d'erreur ni rattrapage
      if (controller.signal.aborted) return

      // Filets de sécurité : quelle que soit la capacité du modèle, l'utilisateur n'est jamais laissé sans résultat
      if (failure) {
        addNotice(convId, `Ollama a renvoyé une erreur : ${failure}`)
        return
      }
      updateConversation(convId, c => {
        const last = c.messages[c.messages.length - 1]
        const answered = last?.role === "assistant" && (last.content.trim() !== "" || !!last.files?.length)

        // Rien d'exploitable (ex. le modèle a épuisé sa limite en réfléchissant)
        if (!answered) {
          const notice: Message = {
            role: "assistant",
            notice: true,
            content: "Le modèle n'a pas produit de réponse (il a probablement épuisé sa limite en réfléchissant). Reformule ou relance la question."
          }
          return { ...c, messages: [...c.messages.filter((m, i) => !(i === c.messages.length - 1 && m.role === "assistant")), notice] }
        }

        // Fichier demandé mais le modèle a écrit du code au lieu d'appeler l'outil : on en fait un fichier
        if (FILE_REQUEST.test(userMessage.content) && !last.files?.length) {
          const blocks = extractCodeBlocks(repairFences(last.content))
          if (blocks.length > 0) {
            const all = c.messages.flatMap(m => m.files ?? [])
            const created: GeneratedFile[] = []
            blocks.forEach((b, i) => {
              const name = blocks.length === 1 && requestedName ? requestedName : `code-${i + 1}.${extensionFor(b.lang)}`
              created.push(makeFile(name, b.code, b.lang, [...all, ...created]))
            })
            return { ...c, messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? { ...m, files: created } : m)) }
          }
        }
        return c
      })
    } catch (error) {
      if (controller.signal.aborted) {
        commitThinking(convId)
        return
      }
      console.error("Erreur lors de l'envoi du message:", error)
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ""
      addNotice(convId, `La connexion avec Ollama a été interrompue${detail}. Vérifie qu'Ollama tourne et que le modèle tient en mémoire (essaie une fenêtre de contexte plus petite), puis réessaie.`)
    } finally {
      abortRef.current = null
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setIsLoading(false)
      setIsStreaming(false)
      setIsThinking(false)
      isThinkingRef.current = false
    }
  }

  const busy = isLoading || isStreaming
  const canSend = !!activeModel && !busy

  return (
    <div className="h-screen flex bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden">

      <Sidebar
        conversations={[...conversations].sort((a, b) => b.updatedAt - a.updatedAt)}
        activeId={activeConv ? activeConv.id : null}
        open={sidebarOpen}
        onSelect={openConversation}
        onNew={newConversation}
        onDelete={deleteConversation}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">

      <header className="shrink-0 flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md z-10">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden w-9 h-9 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <MenuIcon />
          </button>
          <span className="font-sans text-sm font-semibold tracking-widest uppercase bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent select-none">
            Neural-Port
          </span>
        </div>
        <div className="flex items-center gap-1">
        <button
          onClick={() => setSettingsOpen(o => !o)}
          aria-label="Paramètres"
          className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer ${settingsOpen ? "text-indigo-500" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"}`}
        >
          <SlidersIcon />
        </button>
        <button
          onClick={() => setIsDark(!isDark)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex justify-center">
        <div className="relative w-full max-w-3xl">
          <div
            ref={scrollContainerRef}
            onWheel={handleWheel}
            className="h-full overflow-y-auto px-4 py-8 flex flex-col gap-5"
          >
            {messages.map((msg, index) => (
              <Msg
                key={index}
                role={msg.role}
                content={msg.content}
                thinking={msg.thinking}
                tps={msg.tps}
                duration={msg.duration}
                tokens={msg.tokens}
                files={msg.files}
                onSaveCode={(code, lang) => saveCodeAsFile(index, code, lang)}
                onEdit={msg.role === "user" && !busy ? (content: string) => editMessage(index, content) : undefined}
                onRegenerate={msg.role === "assistant" && index === messages.length - 1 && !busy ? regenerate : undefined}
                isStreaming={isStreaming && !isThinking && index === messages.length - 1}
              />
            ))}
            {(isLoading || isThinking) && (
              <div className="flex justify-start msg-in">
                <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl rounded-tl-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-zinc-300 dark:bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-zinc-300 dark:bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
                    <span className="w-1.5 h-1.5 bg-zinc-300 dark:bg-zinc-600 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
                  </div>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {isLoading ? loadingMessage : "Réflexion en cours…"}
                  </span>
                  {isThinking && liveThinking && (
                    <span className="max-w-sm line-clamp-2 text-[11px] italic text-zinc-400 dark:text-zinc-600">
                      {liveThinking.slice(-200)}
                    </span>
                  )}
                </div>
              </div>
            )}
            {messages.length === 0 && !isLoading && !isThinking && (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-16">
                <span className="font-sans text-base font-semibold tracking-widest uppercase bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent select-none">
                  Neural-Port
                </span>
                <p className="text-sm text-zinc-400 dark:text-zinc-500">
                  {activeModel ? "Posez votre première question…" : "Sélectionnez un modèle pour commencer"}
                </p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <button
            onClick={scrollToBottom}
            className={`absolute bottom-5 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center justify-center cursor-pointer transition-all duration-200 ${
              isAtBottom ? 'opacity-0 pointer-events-none translate-y-1' : 'opacity-100 translate-y-0'
            }`}
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-3 py-2 shadow-xs focus-within:border-zinc-300 dark:focus-within:border-zinc-700 transition-colors">
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 resize-none max-h-[10lh] py-2 px-1 leading-relaxed"
            placeholder={activeModel ? `Message à ${activeModel}…` : "Sélectionnez un modèle"}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={1}
            value={inputValue}
            disabled={!activeModel || isLoading || isStreaming}
          />
          <div className="flex items-center gap-1 shrink-0 pb-1">
            <div className="relative">
              <button
                onClick={() => setIsPopupOpen(!isPopupOpen)}
                className="h-8 px-3 rounded-lg text-xs font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1"
              >
                {activeModel && modelStatus !== "idle" && (
                  <span
                    title={modelStatus === "ready" ? "Modèle prêt" : modelStatus === "loading" ? "Chargement du modèle…" : "Échec du chargement"}
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      modelStatus === "ready" ? "bg-emerald-500" : modelStatus === "loading" ? "bg-amber-400 animate-pulse" : "bg-red-500"
                    }`}
                  />
                )}
                <span className="max-w-32 truncate">{activeModel ?? "Modèle"}</span>
                <svg
                  className={`w-3 h-3 shrink-0 transition-transform duration-150 ${isPopupOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {isPopupOpen && (
                <Popup
                  closeMenu={() => setIsPopupOpen(false)}
                  changeModel={(model) => setActiveModel(model)}
                  availableModels={modelList}
                  activeModel={activeModel}
                />
              )}
            </div>
            {busy ? (
              <button
                onClick={stopGeneration}
                aria-label="Arrêter la génération"
                title="Arrêter (Échap)"
                className="w-8 h-8 rounded-xl flex items-center justify-center bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-80 cursor-pointer shadow-sm transition-all"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!canSend}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                  canSend
                    ? 'bg-indigo-500 hover:bg-indigo-600 text-white cursor-pointer shadow-sm'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                }`}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      </div>

      {settingsOpen && (
        <SettingsPanel
          numCtx={numCtx}
          maxCtx={maxCtx}
          used={[...messages].reverse().find(m => m.ctxUsed != null)?.ctxUsed ?? null}
          onChange={setNumCtx}
          thinkEnabled={thinkEnabled}
          onThinkChange={setThinkEnabled}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {panelOpen && !settingsOpen && (
        <FilesPanel
          key={activeId}
          files={files}
          onClose={() => setPanelClosed({ id: activeId, count: files.length })}
        />
      )}

    </div>
  )
}

export default App
