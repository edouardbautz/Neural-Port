import { PlusIcon, TrashIcon, XIcon } from "./icons"

export interface ConversationMeta {
  id: string
  title: string
  model?: string
  updatedAt: number
}

interface SidebarProps {
  conversations: ConversationMeta[]
  activeId: string | null
  open: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
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

function Sidebar({ conversations, activeId, open, onSelect, onNew, onDelete, onClose }: SidebarProps) {
  return (
    <>
      {/* Voile de fond sur mobile (sidebar en overlay) */}
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />}

      <aside
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
            className="md:hidden w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <XIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
                Aucune conversation pour l'instant.
                <br />
                Vos échanges apparaîtront ici.
              </p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => {
                const isActive = c.id === activeId
                return (
                  <li key={c.id} className="group relative">
                    <button
                      onClick={() => onSelect(c.id)}
                      className={`w-full text-left px-3 py-2 pr-9 rounded-lg transition-colors ${
                        isActive
                          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100"
                      }`}
                    >
                      <span className="block text-sm truncate">{c.title}</span>
                      <span className="block text-[11px] truncate text-zinc-400 dark:text-zinc-500">
                        {[c.model, formatRelative(c.updatedAt)].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      title="Supprimer"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}

export default Sidebar
