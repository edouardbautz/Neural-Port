import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import type { Message } from "../App"
import { downloadFile } from "../lib/files"
import { CheckIcon, CopyIcon, PencilIcon, RefreshIcon } from "./icons"

// Le rendu Markdown (react-markdown, remark, coloration syntaxique) pèse l'essentiel du bundle : il est chargé à part.
// Le chargement démarre tout de suite, en parallèle de l'initialisation de l'application.
const loadMarkdownView = () => import("./MarkdownView")
const MarkdownView = lazy(loadMarkdownView)
void loadMarkdownView()

interface MsgProps extends Message {
  isStreaming?: boolean
  onSaveCode?: (code: string, lang: string | null) => void
  onEdit?: (content: string) => void  // modification d'un message utilisateur
  onRegenerate?: () => void           // régénération de la dernière réponse
}

function formatNumber(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })
}

function Msg({ role, content, thinking, approx, tps, duration, tokens, files, onSaveCode, onEdit, onRegenerate, isStreaming = false }: MsgProps) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)

  // Rappel stable : le rendu Markdown est mémoïsé et ne doit pas être refait parce qu'une fonction a changé d'identité
  const onSaveRef = useRef(onSaveCode)
  useEffect(() => {
    onSaveRef.current = onSaveCode
  })
  const handleSave = useCallback((code: string, lang: string | null) => onSaveRef.current?.(code, lang), [])

  // Statistiques réelles fournies par Ollama (null si l'API ne les renvoie pas)
  // Le préfixe « ≈ » signale une part estimée : réflexion d'une première tentative interrompue (Ollama ne la comptabilise pas)
  const approxNote = approx ? " Une réflexion interrompue puis relancée est comptée par estimation (≈)." : ""
  const pre = approx ? "≈ " : ""
  const stats: { text: string; hint: string }[] = []
  if (tokens != null) stats.push({ text: `${pre}${formatNumber(tokens)} tokens`, hint: `Tokens générés par le modèle, réflexion comprise : peut dépasser la longueur du texte affiché.${approxNote}` })
  if (duration != null) stats.push({ text: `${pre}${formatNumber(duration)} s`, hint: `Durée de génération (réflexion comprise), sans le chargement du modèle ni la lecture de ta question.${approxNote}` })
  if (tps != null) stats.push({ text: `${pre}${formatNumber(tps)} tokens/s`, hint: `Vitesse de génération : tokens générés ÷ durée de génération.${approxNote}` })

  function handleCopy() {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {}
    )
  }

  if (role === "user") {
    if (editing) {
      function submit() {
        setEditing(false)
        if (draft.trim() && draft !== content) onEdit?.(draft)
      }
      return (
        <div className="flex justify-end msg-in">
          <div className="w-full max-w-[72%] flex flex-col gap-2 p-3 rounded-2xl border border-indigo-400 dark:border-indigo-500 bg-white dark:bg-zinc-900">
            <textarea
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() }
                if (e.key === "Escape") { e.stopPropagation(); setEditing(false) }
              }}
              rows={Math.min(8, draft.split("\n").length + 1)}
              className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed"
            />
            <div className="flex justify-end gap-2 text-xs">
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">Annuler</button>
              <button onClick={submit} className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white font-medium cursor-pointer">Envoyer</button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="flex justify-end items-center gap-2 msg-in group/user">
        {onEdit && (
          <button
            onClick={() => { setDraft(content); setEditing(true) }}
            title="Modifier le message"
            aria-label="Modifier le message"
            className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover/user:opacity-100 focus:opacity-100 transition-all cursor-pointer"
          >
            <PencilIcon />
          </button>
        )}
        <p className="max-w-[72%] min-w-0 px-4 py-2.5 rounded-2xl rounded-br-sm bg-indigo-500 dark:bg-indigo-600 text-white text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {content}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1.5 msg-in group/msg">
      {content.length > 0 || isStreaming ? (
      <div className={`relative max-w-[80%] min-w-0 [overflow-wrap:anywhere] px-4 py-3 rounded-2xl rounded-tl-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm transition-shadow${isStreaming ? " streaming-bubble" : ""}`}>
        {!isStreaming && (
          <button
            onClick={handleCopy}
            aria-label="Copier la réponse"
            className="absolute -top-2.5 -right-2.5 w-7 h-7 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-all opacity-0 group-hover/msg:opacity-100 focus:opacity-100 cursor-pointer"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        {thinking && (
          <details className="group/think mb-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50">
            <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
              Réflexion du modèle
            </summary>
            <p className="max-h-60 overflow-y-auto px-3 pb-3 pt-1 text-xs leading-relaxed italic whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
              {thinking}
            </p>
          </details>
        )}
        <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none np-prose">
          <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
            <MarkdownView content={content} streaming={isStreaming} canSave={!!onSaveCode} onSave={handleSave} />
          </Suspense>
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
              <span className="text-zinc-600 dark:text-zinc-400">↓</span>
            </button>
          ))}
        </div>
      )}
      {!isStreaming && (stats.length > 0 || onRegenerate) && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-[11px] leading-none text-zinc-600 dark:text-zinc-400 tabular-nums">
          {stats.map((s, i) => (
            <span key={i} title={s.hint} className="flex items-center gap-x-1.5">
              {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
              {s.text}
            </span>
          ))}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1 px-1.5 py-2 -my-1.5 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              {stats.length > 0 && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
              <RefreshIcon />
              Régénérer
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default Msg
