import { useEffect, useState } from "react"
import { PencilIcon, PlusIcon, TrashIcon, XIcon } from "./icons"

export interface ConversationMeta {
  id: string
  title: string
  model?: string
  updatedAt: number
  messages?: { content: string }[]  // utilisé pour la recherche
}

interface SidebarProps {
  conversations: ConversationMeta[]
  activeId: string | null
  open: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onClose: () => void
}

function formatRelative(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  if (d.toDateString() === now.toDateString()) return "aujourd'hui"
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return "hier"
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric"
  return d.toLocaleDateString("fr-FR", opts)
}

function Sidebar({ conversations, activeId, open, onSelect, onNew, onDelete, onRename, onClose }: SidebarProps) {
  const [query, setQuery] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  // Sur mobile la liste recouvre la page : Échap la referme
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  const q = query.trim().toLowerCase()
  const visible = q
    ? conversations.filter(c => c.title.toLowerCase().includes(q) || c.messages?.some(m => m.content.toLowerCase().includes(q)))
    : conversations

  function commitRename(id: string) {
    setRenamingId(null)
    if (draft.trim()) onRename(id, draft.trim())
  }

  return (
    <>
      {/* Voile de fond sur mobile (sidebar en overlay) */}
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />}

      <nav
        aria-label="Conversations"
        className={`${open ? "flex" : "hidden"} md:flex fixed md:static inset-y-0 left-0 z-40 md:z-auto w-64 shrink-0 flex-col bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800`}
      >
        <div className="shrink-0 p-3 flex items-center gap-1">
          <button
            onClick={onNew}
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
          >
            <PlusIcon />
            Nouvelle conversation
          </button>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="md:hidden w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <XIcon />
          </button>
        </div>

        {conversations.length > 0 && (
          <div className="shrink-0 px-3 pb-2">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher…"
              aria-label="Rechercher dans les conversations"
              className="w-full px-3 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-800 placeholder-zinc-500 dark:placeholder-zinc-400 outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Aucune conversation pour l'instant.
                <br />
                Vos échanges apparaîtront ici.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-zinc-600 dark:text-zinc-400">Aucun résultat pour « {query} »</p>
          ) : (
            <ul className="space-y-0.5">
              {visible.map((c) => {
                const isActive = c.id === activeId
                return (
                  <li key={c.id} className="group relative">
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => commitRename(c.id)}
                        onKeyDown={e => {
                          if (e.key === "Enter") commitRename(c.id)
                          if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null) }
                        }}
                        maxLength={80}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-800 outline-none ring-1 ring-indigo-400"
                      />
                    ) : (
                    <button
                      onClick={() => onSelect(c.id)}
                      onDoubleClick={() => { setDraft(c.title); setRenamingId(c.id) }}
                      className={`w-full text-left px-3 py-2 pr-16 rounded-lg transition-colors ${
                        isActive
                          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100"
                      }`}
                    >
                      <span className="block text-sm truncate">{c.title}</span>
                      <span className="block text-[11px] truncate text-zinc-600 dark:text-zinc-400">
                        {[c.model, formatRelative(c.updatedAt)].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    )}
                    {renamingId !== c.id && (
                    <button
                      onClick={() => { setDraft(c.title); setRenamingId(c.id) }}
                      title="Renommer"
                      aria-label="Renommer la conversation"
                      className="absolute right-9 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer"
                    >
                      <PencilIcon />
                    </button>
                    )}
                    <button
                      onClick={() => onDelete(c.id)}
                      title="Supprimer"
                      aria-label="Supprimer la conversation"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </nav>
    </>
  )
}

export default Sidebar
