import { useEffect, useMemo, useRef, useState } from 'react'
import Popup from './components/Popup'
import Msg from './components/Msg'
import Sidebar from './components/Sidebar'
import FilesPanel from './components/FilesPanel'
import SettingsPanel from './components/SettingsPanel'
import CompactionDivider from './components/CompactionDivider'
import { ctxSteps, isThinkLevel, THINK_LEVELS, type ThinkLevel } from './lib/context'
import { repairFences } from './lib/markdown'
import {
  compactConversation,
  DEFAULT_COMPACTION,
  estimatePromptTokens,
  isSettings as isCompactionSettings,
  messageText,
  requestChars,
  shouldCompact,
  summaryInjection,
  visibleThread,
  type CompactionSettings,
  type ConversationSummary
} from './lib/compaction'
import { makeOllamaSummarizer } from './lib/summarize'
import { ratioFrom, type Calibration } from './lib/tokens'
import { extensionFor, extractCodeBlocks, filenameFromRequest, isFileRequest, makeFile, type GeneratedFile } from './lib/files'
import { Fragment } from 'react'
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
  approx?: boolean   // les statistiques incluent une estimation (réflexion interrompue puis relancée)
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
  summary?: ConversationSummary  // résumé qui remplace, pour le modèle, les messages [0, summary.upTo[
  calib?: Calibration             // dernière mesure réelle de la taille du prompt (tokens Ollama / caractères envoyés)
}

const HISTORY_KEY = "neural-port-history"
const CTX_KEY = "neural-port-ctx"
const MODEL_KEY = "neural-port-model"
const THINK_KEY = "neural-port-think"
const COMPACT_KEY = "neural-port-compaction"
const DEFAULT_CTX = 16384
const ACTIVE_KEY = "neural-port-active"

// Un résumé n'est valable que s'il laisse au moins le dernier message utilisateur hors de sa portée
function validSummary(summary: ConversationSummary | undefined, threadLength: number): ConversationSummary | undefined {
  return summary && summary.upTo <= threadLength - 1 ? summary : undefined
}

// Une entrée corrompue du stockage ne doit pas faire planter l'application
function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.messages) &&
    c.messages.every(m => !!m && typeof m === "object" && ((m as Message).role === "user" || (m as Message).role === "assistant") && typeof (m as Message).content === "string") &&
    typeof c.updatedAt === "number"
  )
}

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

const SUGGESTIONS = [
  "Explique-moi un concept simplement",
  "Écris un script Python dans un fichier",
  "Résume ce texte en trois phrases",
  "Aide-moi à corriger mon code"
]

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
interface ModelInfo { tools: boolean; thinking: boolean; thinkLevels: boolean; maxCtx: number | null }
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
    const data = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown>; details?: { family?: string } }
    const key = Object.keys(data.model_info ?? {}).find(k => k.endsWith(".context_length"))
    const max = key ? data.model_info![key] : null
    const info: ModelInfo = {
      tools: data.capabilities?.includes("tools") ?? false,
      thinking: data.capabilities?.includes("thinking") ?? false,
      // Seule la famille GPT-OSS honore les niveaux low/medium/high ; les autres n'ont qu'un on/off
      thinkLevels: /gpt-?oss/i.test(`${model} ${data.details?.family ?? ""}`),
      maxCtx: typeof max === "number" ? max : null
    }
    modelInfoCache.set(model, info)
    return info
  } catch {
    return { tools: false, thinking: false, thinkLevels: false, maxCtx: null }
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
    try {
      const saved = localStorage.getItem('neural-port-theme')
      if (saved) return saved === 'dark'
    } catch {
      // stockage indisponible
    }
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
  // Anciennes valeurs enregistrées : « auto » devient « medium »
  const [thinkLevel, setThinkLevel] = useState<ThinkLevel>(() => {
    try {
      const saved = localStorage.getItem(THINK_KEY)
      if (isThinkLevel(saved)) return saved
    } catch {
      // ignore
    }
    return "medium"
  })
  const [thinkSupport, setThinkSupport] = useState<"none" | "toggle" | "levels">("toggle")
  const [compaction, setCompaction] = useState<CompactionSettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COMPACT_KEY) ?? "null")
      if (isCompactionSettings(saved)) return saved
    } catch {
      // ignore
    }
    return DEFAULT_COMPACTION
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
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.filter(isConversation)
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
    try {
      localStorage.setItem('neural-port-theme', isDark ? 'dark' : 'light')
    } catch {
      // ignore
    }
  }, [isDark])

  // Persistance de l'historique et de la conversation active
  // (écriture différée : pendant le streaming, `conversations` change à chaque fragment de texte)
  // `dirtyRef` : seul un onglet qui a modifié l'historique l'écrit, sinon il écraserait celui d'un autre onglet
  const conversationsRef = useRef(conversations)
  const dirtyRef = useRef(false)
  const loadedRef = useRef(conversations) // état lu au démarrage : tant qu'il n'a pas changé, rien à écrire
  useEffect(() => {
    conversationsRef.current = conversations
    if (conversations === loadedRef.current) return
    dirtyRef.current = true
    const timer = setTimeout(saveHistory, 400)
    return () => clearTimeout(timer)
  }, [conversations])

  useEffect(() => {
    window.addEventListener("pagehide", saveHistory)
    return () => window.removeEventListener("pagehide", saveHistory)
  }, [])

  function saveHistory() {
    if (!dirtyRef.current) return
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(conversationsRef.current))
      dirtyRef.current = false
    } catch {
      // Stockage plein ou bloqué : l'historique ne sera simplement pas conservé
    }
  }

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
      localStorage.setItem(COMPACT_KEY, JSON.stringify(compaction))
    } catch {
      // ignore
    }
  }, [compaction])

  useEffect(() => {
    try {
      localStorage.setItem(THINK_KEY, thinkLevel)
    } catch {
      // ignore
    }
  }, [thinkLevel])

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
      if (cancelled) return
      setMaxCtx(info.maxCtx)
      setThinkSupport(!info.thinking ? "none" : info.thinkLevels ? "levels" : "toggle")
    })
    return () => { cancelled = true }
  }, [activeModel])

  // Raccourcis clavier : Échap arrête la génération, Ctrl+K nouvelle conversation, Ctrl+, paramètres
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") abortRef.current?.abort()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (!abortRef.current) {
          setActiveId(null)
          setSidebarOpen(false)
          textareaRef.current?.focus()
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault()
        setSettingsOpen(open => !open)
      }
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

  // Suit la position réelle (molette, tactile, barre de défilement, clavier) : le défilement automatique
  // se suspend dès qu'on remonte et reprend quand on revient en bas
  function handleScroll() {
    const container = scrollContainerRef.current
    if (container) setIsAtBottom(container.scrollHeight - container.scrollTop - container.clientHeight < 30)
  }

  function handleWheel(event: React.WheelEvent) {
    if (event.deltaY < 0) setIsAtBottom(false)
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
    const summary = validSummary(activeConv.summary, thread.length)
    updateConversation(activeConv.id, c => ({ ...c, messages: thread, summary, calib: undefined }))
    void generate(activeConv.id, thread, { summary })
  }

  // Modifie un message de l'utilisateur : la conversation repart de ce point
  function editMessage(index: number, content: string) {
    if (!activeConv || busy || !content.trim()) return
    const thread: Message[] = [...activeConv.messages.slice(0, index), { role: "user", content }]
    const summary = validSummary(activeConv.summary, thread.length)
    updateConversation(activeConv.id, c => ({ ...c, messages: thread, summary, calib: undefined }))
    void generate(activeConv.id, thread, { summary })
  }

  // Compacte la conversation (résumé roulant) et enregistre le résultat ; ne renvoie rien en cas d'échec
  async function runCompaction(
    convId: string,
    messages: Message[],
    previous: ConversationSummary | undefined,
    calib: Calibration | undefined,
    info: { thinking: boolean },
    signal: AbortSignal,
    auto: boolean
  ): Promise<{ summary?: ConversationSummary; failure?: "nothing" | "invalid" | "error" }> {
    const summarize = makeOllamaSummarizer({ baseUrl: OLLAMA_URL, model: activeModel!, numCtx: effectiveCtx, canThink: info.thinking, signal })
    try {
      const result = await compactConversation({
        messages,
        previous,
        ctx: effectiveCtx,
        ratio: ratioFrom(calib),
        auto,
        summarize,
        onProgress: (done, total) => {
          if (total > 1 && done < total) setLoadingMessage(`Compaction de la conversation… (${done + 1}/${total})`)
        }
      })
      if (result.ok) {
        updateConversation(convId, c => ({ ...c, summary: result.summary, calib: undefined }))
        return { summary: result.summary }
      }
      return { failure: result.reason }
    } catch (error) {
      if (signal.aborted) throw error
      console.warn("Compaction impossible :", error)
      return { failure: "error" }
    }
  }

  // Compaction demandée à la main depuis les paramètres
  async function compactNow() {
    if (!activeConv || busy || !activeModel) return
    const conv = activeConv
    const controller = new AbortController()
    abortRef.current = controller
    setLoadingMessage("Compaction de la conversation…")
    setIsLoading(true)
    try {
      const info = await getModelInfo(activeModel)
      const result = await runCompaction(conv.id, conv.messages, conv.summary, conv.calib, info, controller.signal, false)
      if (!result.summary) {
        addNotice(
          conv.id,
          result.failure === "nothing"
            ? "Il n'y a rien à compacter pour l'instant : la conversation est trop courte."
            : result.failure === "invalid"
              ? "Le résumé obtenu n'est pas plus court que la conversation : elle est trop courte pour être compactée utilement."
              : "La compaction a échoué : impossible d'obtenir un résumé du modèle."
        )
      }
    } catch {
      // arrêt demandé par l'utilisateur
    } finally {
      abortRef.current = null
      setIsLoading(false)
    }
  }

  // Supprime le résumé : tout l'historique d'origine est de nouveau envoyé au modèle
  function clearSummary() {
    if (!activeConv || busy) return
    updateConversation(activeConv.id, c => ({ ...c, summary: undefined, calib: undefined }))
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

  // Renomme sans modifier la date de dernière activité (la conversation ne remonte pas dans la liste)
  function renameConversation(id: string, title: string) {
    setConversations(prev => prev.map(c => (c.id === id ? { ...c, title } : c)))
  }

  function openConversation(id: string) {
    if (isLoading || isStreaming) return
    setActiveId(id)
    setIsAtBottom(true)
    setSidebarOpen(false)
  }

  function deleteConversation(id: string) {
    if (!window.confirm("Supprimer cette conversation ?")) return
    // La génération en cours écrirait dans une conversation disparue
    if (id === activeId) abortRef.current?.abort()
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
    await generate(convId, [...(activeConv?.messages ?? []), userMessage], { summary: activeConv?.summary, calib: activeConv?.calib })
  }

  // Demande une réponse au modèle pour la conversation `thread` (qui se termine par un message utilisateur)
  async function generate(convId: string, thread: Message[], state: { summary?: ConversationSummary; calib?: Calibration } = {}) {
    const userMessage = [...thread].reverse().find(m => m.role === "user")!
    setIsAtBottom(true)

    // Verrouille l'interface tout de suite : on ne peut pas relancer un envoi pendant la vérification du modèle
    setLoadingMessage("Préparation…")
    setIsLoading(true)
    // Créé tout de suite : Échap et Ctrl+K voient la génération même pendant la vérification du modèle
    const controller = new AbortController()
    abortRef.current = controller
    const modelAlreadyLoaded = await checkModelLoaded(activeModel!)
    if (controller.signal.aborted) {
      abortRef.current = null
      setIsLoading(false)
      return
    }
    setLoadingMessage(modelAlreadyLoaded ? "Traitement du contexte…" : "Chargement du modèle…")

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

    // Nom de fichier cité par l'utilisateur (« crée jeu.py ») : il prime sur celui choisi par le modèle
    const requestedName = filenameFromRequest(userMessage.content)
    let failure: string | null = null  // erreur renvoyée par Ollama pendant le flux
    // Réflexion d'une tentative interrompue : Ollama ne renvoie pas de statistiques pour un flux coupé,
    // on l'estime (~4 caractères par token) pour que les totaux affichés comptent bien toute la réflexion
    let carriedTokens = 0
    let carriedSec = 0

    try {
      // L'outil n'est proposé que si le message parle explicitement d'un fichier : un petit modèle
      // l'appellerait sinon dès qu'on lui demande du code, et réfléchirait longuement à la consigne
      const info = await getModelInfo(activeModel!)
      const useTools = isFileRequest(userMessage.content) && info.tools

      // Compaction : si la requête risque de dépasser le seuil de la fenêtre de contexte, les anciens messages
      // sont résumés (les messages d'origine restent affichés et conservés)
      let summary = state.summary
      let calib = state.calib
      let tail = visibleThread(thread, summary?.upTo ?? 0)
      if (compaction.enabled) {
        const estimate = estimatePromptTokens(requestChars(tail, summary, useTools), tail.length, calib)
        if (shouldCompact(estimate, effectiveCtx, compaction.threshold)) {
          setLoadingMessage("Compaction de la conversation…")
          const result = await runCompaction(convId, thread, summary, calib, info, controller.signal, true)
          if (result.summary) {
            summary = result.summary
            calib = undefined
            tail = visibleThread(thread, summary.upTo)
          }
          setLoadingMessage("Traitement du contexte…")
        }
      }
      // Taille (en caractères) de ce qui est réellement envoyé : sert à calibrer l'estimation avec la mesure d'Ollama
      const sentChars = requestChars(tail, summary, useTools)

      // On n'envoie que role/content à Ollama (stats exclues) ; les fichiers créés sont rappelés au modèle
      const history = tail.map(m => ({ role: m.role, content: messageText(m) }))
      const systemContent = [useTools ? SYSTEM_PROMPT : "", summary ? summaryInjection(summary) : ""].filter(Boolean).join("\n\n")

      // Les modèles « réfléchisseurs » épuisent parfois leur limite de tokens en pensant, sans rien répondre.
      // Dans ce cas on relance une fois, sans réflexion, avant d'abandonner.
      let retryMessage = "Nouvelle tentative…"
      for (let attempt = 0; attempt < 2; attempt++) {
        failure = null
        if (attempt > 0) {
          setLoadingMessage(retryMessage)
          setIsLoading(true)
          setIsStreaming(false)
          setIsThinking(false)
          isThinkingRef.current = false
        }

        // Annulation propre à cette tentative : l'arrêt demandé par l'utilisateur s'y propage aussi
        const attemptCtl = new AbortController()
        const onUserAbort = () => attemptCtl.abort()
        controller.signal.addEventListener("abort", onUserAbort)
        if (controller.signal.aborted) attemptCtl.abort()
        // Pour les modèles sans niveaux natifs, on limite nous-mêmes la durée de réflexion selon le niveau choisi
        const budget = THINK_LEVELS.find(l => l.id === thinkLevel)!.budgetChars
        const canOverthink = attempt === 0 && info.thinking && !info.thinkLevels && thinkLevel !== "off" && budget !== null
        let overthought = false
        let firstTokenAt: number | null = null  // début de la génération (exclut chargement et lecture de la question)

        try {
          const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: activeModel,
              messages: systemContent ? [{ role: "system", content: systemContent }, ...history] : history,
              ...(useTools ? { tools: [CREATE_FILE_TOOL] } : {}),
              options: { num_ctx: effectiveCtx },
              // `think` n'est accepté que par les modèles qui savent raisonner
              ...(info.thinking
                ? attempt > 0 || thinkLevel === "off"
                  ? { think: false }
                  : info.thinkLevels
                    ? { think: thinkLevel }
                    : {}
                : {}),
              stream: true
            }),
            signal: attemptCtl.signal
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

            // À la fin du flux, la dernière ligne (sans retour à la ligne) est traitée aussi
            const parts = (carry + (done ? decoder.decode() : decoder.decode(value, { stream: true }))).split('\n')
            carry = done ? "" : (parts.pop() ?? "")
            const lines = parts.filter(line => line.trim())

            for (const line of lines) {
              if (overthought) break
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
                  const ctxUsed = (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0)
                  if (chunk.prompt_eval_count && chunk.prompt_eval_count > 0) {
                    const measured = { tokens: chunk.prompt_eval_count, chars: sentChars }
                    updateConversation(convId, c => ({ ...c, calib: measured }))
                  }
                  const tokens = chunk.eval_count ? chunk.eval_count + carriedTokens : undefined
                  const sec = (chunk.eval_duration ?? 0) / 1e9 + carriedSec
                  if (tokens && tokens > 0 && sec > 0) {
                    updateMessages(convId, prev => {
                      const last = prev[prev.length - 1]
                      if (!last || last.role !== "assistant") return prev
                      const arr = [...prev]
                      arr[arr.length - 1] = { ...last, tps: tokens / sec, duration: sec, tokens, ctxUsed, approx: carriedTokens > 0 }
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
                  firstTokenAt = Date.now()
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
                  // Un petit modèle peut réfléchir pendant des minutes sur une question simple : on coupe et on relance sans réflexion
                  if (canOverthink && !rawBufferRef.current && thinkBufferRef.current.length > budget!) {
                    overthought = true
                    attemptCtl.abort()
                  }
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
            if (done) break
          }
        } catch (error) {
          if (!overthought) throw error
          retryMessage = "Réflexion trop longue, je réponds directement…"
          carriedTokens += Math.round(thinkBufferRef.current.length / 4)
          if (firstTokenAt !== null) carriedSec += (Date.now() - firstTokenAt) / 1000
        } finally {
          controller.signal.removeEventListener("abort", onUserAbort)
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
        if (isFileRequest(userMessage.content) && !last.files?.length) {
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
        onRename={renameConversation}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">

      <header className="shrink-0 flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md z-10">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir la liste des conversations"
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
          aria-label={isDark ? "Passer au thème clair" : "Passer au thème sombre"}
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
            onScroll={handleScroll}
            className="h-full overflow-y-auto px-4 py-8 flex flex-col gap-5"
          >
            {messages.map((msg, index) => (
              <Fragment key={`${activeId}-${index}`}>
              {activeConv?.summary && index === activeConv.summary.upTo && <CompactionDivider summary={activeConv.summary} />}
              <div className={activeConv?.summary && index < activeConv.summary.upTo ? "opacity-60" : undefined}>
              <Msg
                role={msg.role}
                content={msg.content}
                thinking={msg.thinking}
                tps={msg.tps}
                duration={msg.duration}
                tokens={msg.tokens}
                approx={msg.approx}
                files={msg.files}
                onSaveCode={isStreaming && index === messages.length - 1 ? undefined : (code, lang) => saveCodeAsFile(index, code, lang)}
                onEdit={msg.role === "user" && !busy ? (content: string) => editMessage(index, content) : undefined}
                onRegenerate={msg.role === "assistant" && index === messages.length - 1 && !busy ? regenerate : undefined}
                isStreaming={isStreaming && !isThinking && index === messages.length - 1}
              />
              </div>
              </Fragment>
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
                {activeModel && (
                  <div className="mt-4 flex flex-wrap justify-center gap-2 max-w-md">
                    {SUGGESTIONS.map(text => (
                      <button
                        key={text}
                        onClick={() => {
                          setInputValue(text)
                          textareaRef.current?.focus()
                        }}
                        className="px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-500 dark:text-zinc-400 hover:border-indigo-400 hover:text-indigo-500 dark:hover:border-indigo-500 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-6 text-[11px] text-zinc-300 dark:text-zinc-700 select-none">
                  Ctrl+K nouvelle conversation · Ctrl+, paramètres · Échap arrêter
                </p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <button
            onClick={scrollToBottom}
            aria-label="Aller au dernier message"
            tabIndex={isAtBottom ? -1 : 0}
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
                disabled={busy}
                aria-label="Choisir le modèle"
                aria-haspopup="listbox"
                className="h-8 px-3 rounded-lg text-xs font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1"
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
                aria-label="Envoyer"
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
          compaction={compaction}
          onCompactionChange={setCompaction}
          summary={activeConv?.summary ?? null}
          canCompact={!!activeConv && !busy && !!activeModel && messages.length > 2}
          busy={busy}
          nextEstimate={
            activeConv
              ? estimatePromptTokens(requestChars(visibleThread(messages, activeConv.summary?.upTo ?? 0), activeConv.summary, false), messages.length, activeConv.calib)
              : null
          }
          effectiveCtx={effectiveCtx}
          onCompactNow={compactNow}
          onClearSummary={clearSummary}
          thinkLevel={thinkLevel}
          thinkSupport={thinkSupport}
          onThinkChange={setThinkLevel}
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
