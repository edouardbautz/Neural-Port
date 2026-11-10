import { useState } from "react"
import { Children, isValidElement, type ReactNode } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import type { Message } from "../App"
import { downloadFile } from "../lib/files"
import { repairFences } from "../lib/markdown"
import { CheckIcon } from "./icons"

interface MsgProps extends Message {
  isStreaming?: boolean
  onSaveCode?: (code: string, lang: string | null) => void
}

function formatNumber(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })
}

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

// Récupère le texte brut d'un nœud React (utilisé pour copier le code)
function extractCodeText(node: ReactNode): string {
  if (typeof node === "string") return node
  if (Array.isArray(node)) return node.map(extractCodeText).join("")
  if (isValidElement(node)) {
    return extractCodeText((node.props as { children?: ReactNode }).children)
  }
  return ""
}

// Détecte la langue sur <code class="hljs language-xxx"> (enfants de <pre>)
function detectLanguage(children: ReactNode): string | null {
  for (const child of Children.toArray(children)) {
    if (isValidElement(child)) {
      const cls = (child.props as { className?: string }).className ?? ""
      const match = /language-([\w-]+)/.exec(cls)
      if (match) return match[1]
    }
  }
  return null
}

function CodeBlock({ children, onSave }: { children?: ReactNode; onSave?: (code: string, lang: string | null) => void }) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const lang = detectLanguage(children)

  function handleCopy() {
    navigator.clipboard.writeText(extractCodeText(children))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleSave() {
    onSave?.(extractCodeText(children), lang)
    setSaved(true)
  }

  // Bloc vide (fence parasite d'un petit modèle) : on n'affiche pas de cadre avec des boutons pour rien
  if (extractCodeText(children).trim() === "") return null

  return (
    <div className="not-prose my-4 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs">
      <div className="flex items-center justify-between gap-3 px-3.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500 select-none">
          {lang ?? "code"}
        </span>
        <div className="flex items-center gap-3">
          {onSave && (
            <button
              onClick={handleSave}
              disabled={saved}
              className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-zinc-400"
            >
              {saved ? "Fichier créé" : "Créer un fichier"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  )
}

function Msg({ role, content, tps, duration, tokens, files, onSaveCode, isStreaming = false }: MsgProps) {
  const [copied, setCopied] = useState(false)

  // Statistiques réelles fournies par Ollama (null si l'API ne les renvoie pas)
  const stats: string[] = []
  if (tokens != null) stats.push(`${formatNumber(tokens)} tokens`)
  if (duration != null) stats.push(`${formatNumber(duration)} s`)
  if (tps != null) stats.push(`${formatNumber(tps)} tokens/s`)

  function handleCopy() {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (role === "user") {
    return (
      <div className="flex justify-end msg-in">
        <p className="max-w-[72%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-indigo-500 dark:bg-indigo-600 text-white text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1.5 msg-in group/msg">
      {content.length > 0 || isStreaming ? (
      <div className={`relative max-w-[80%] px-4 py-3 rounded-2xl rounded-tl-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm transition-shadow${isStreaming ? " streaming-bubble" : ""}`}>
        {!isStreaming && (
          <button
            onClick={handleCopy}
            className="absolute -top-2.5 -right-2.5 w-7 h-7 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-all opacity-0 group-hover/msg:opacity-100 cursor-pointer"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none np-prose">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeHighlight, { detect: true }]]}
            components={{
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="not-prose my-4 overflow-x-auto">
                  <table>{children}</table>
                </div>
              ),
              pre: ({ children }) => <CodeBlock onSave={onSaveCode}>{children}</CodeBlock>,
            }}
          >
            {isStreaming && content.length > 0 ? repairFences(content) + " ▋" : repairFences(content)}
          </Markdown>
        </div>
      </div>
      ) : null}
      {files && files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map(f => (
            <button
              key={f.id}
              onClick={() => downloadFile(f)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors cursor-pointer"
              title="Télécharger"
            >
              <span aria-hidden>📄</span>
              {f.name}
              <span className="text-zinc-400 dark:text-zinc-500">↓</span>
            </button>
          ))}
        </div>
      )}
      {!isStreaming && stats.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1.5 px-1 text-[11px] leading-none text-zinc-400 dark:text-zinc-500 tabular-nums">
          {stats.map((s, i) => (
            <span key={i} className="flex items-center gap-x-1.5">
              {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default Msg
