import { useEffect, useRef, useState } from 'react'
import Popup from './components/Popup'
import Msg from './components/Msg'

const OLLAMA_URL = "http://localhost:11434"

export interface Message {
  role: "user" | "assistant"
  content: string
}

export interface OllamaModelResponse {
  models: {
    name: string
    model: string
  }[]
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
  const [activeModel, setActiveModel] = useState<string>()
  const [inputValue, setInputValue] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState("")
  const rawBufferRef = useRef("")
  const hasAssistantMsgRef = useRef(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isThinkingRef = useRef(false)
  const thinkOpenIdxRef = useRef(-1)
  const thinkCloseIdxRef = useRef(-1)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [modelList, setModelList] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('neural-port-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    if (!isAtBottom) return
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
  }, [messages, isAtBottom, isLoading, isThinking])

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

  async function sendMessage() {
    if (!inputValue.trim() || isLoading || isStreaming) return

    const userMessage: Message = { role: "user", content: inputValue }
    const updatedMessages = [...messages, userMessage]

    setInputValue("")
    setIsAtBottom(true)
    setMessages(updatedMessages)

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

    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: activeModel,
          messages: updatedMessages,
          stream: true
        })
      })

      if (!response.body) throw new Error("Réponse vide du serveur")

      setIsStreaming(true)
      rawBufferRef.current = ""
      hasAssistantMsgRef.current = false
      isThinkingRef.current = false
      thinkOpenIdxRef.current = -1
      thinkCloseIdxRef.current = -1

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let firstChunk = true

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value).split('\n').filter(line => line.trim())

        for (const line of lines) {
          try {
            const chunk = JSON.parse(line) as { message?: { content: string; thinking?: string } }
            const hasThinking = !!chunk.message?.thinking
            const hasContent = !!chunk.message?.content

            if (!hasThinking && !hasContent) continue

            if (firstChunk) {
              setIsLoading(false)
              firstChunk = false
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
                  setMessages(prev => [...prev, { role: "assistant", content: displayContent }])
                  hasAssistantMsgRef.current = true
                } else {
                  setMessages(prev => {
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
    } catch (error) {
      console.error("Erreur lors de l'envoi du message:", error)
    } finally {
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

  const canSend = !!activeModel && !isLoading && !isStreaming

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">

      <header className="shrink-0 flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md z-10">
        <span className="font-sans text-sm font-semibold tracking-widest uppercase bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent select-none">
          Neural-Port
        </span>
        <button
          onClick={() => setIsDark(!isDark)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
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
                </div>
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
          </div>
        </div>
      </div>

    </div>
  )
}

export default App
