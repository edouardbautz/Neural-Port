import { Children, isValidElement, memo, useMemo, useState, type ReactNode } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { repairFences } from "../lib/markdown"
import { CheckIcon, CopyIcon } from "./icons"

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
    navigator.clipboard.writeText(extractCodeText(children)).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {} // presse-papiers indisponible (contexte non sécurisé, permission refusée)
    )
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
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400 select-none">
          {lang ?? "code"}
        </span>
        <div className="flex items-center gap-3">
          {onSave && (
            <button
              onClick={handleSave}
              disabled={saved}
              className="px-1.5 py-2 -my-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-zinc-600 dark:disabled:hover:text-zinc-400"
            >
              {saved ? "Fichier créé" : "Créer un fichier"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-1.5 py-2 -my-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
      </div>
      <pre tabIndex={0} role="region" aria-label={`Code ${lang ?? ""}`.trim()} className="overflow-x-auto p-3.5 text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  )
}


const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS: React.ComponentProps<typeof Markdown>["rehypePlugins"] = [[rehypeHighlight, { detect: true }]]

interface MarkdownViewProps {
  content: string
  streaming: boolean
  canSave: boolean                                          // le bouton « Créer un fichier » est-il proposé ?
  onSave: (code: string, lang: string | null) => void       // doit être stable (sinon la mémoïsation ne sert à rien)
}

// Mémoïsé : pendant le streaming, seul le message en cours change ; les autres ne sont pas ré-analysés à chaque fragment.
const MarkdownView = memo(function MarkdownView({ content, streaming, canSave, onSave }: MarkdownViewProps) {
  const components = useMemo<Components>(() => ({
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
    pre: ({ children }) => <CodeBlock onSave={canSave ? onSave : undefined}>{children}</CodeBlock>,
  }), [canSave, onSave])

  const text = useMemo(() => {
    const repaired = repairFences(content)
    return streaming && content.length > 0 ? repaired + " ▋" : repaired
  }, [content, streaming])

  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
      {text}
    </Markdown>
  )
})

export default MarkdownView
