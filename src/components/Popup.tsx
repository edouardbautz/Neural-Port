import { useEffect, useRef } from "react"
import { CheckIcon } from "./icons"

interface PopupProps {
  closeMenu: () => void
  changeModel: (modelName: string) => void
  availableModels: string[]
  activeModel?: string
}

function Popup({ closeMenu, changeModel, availableModels, activeModel }: PopupProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // À l'ouverture, le focus va sur le modèle actif (ou le premier) : le menu se pilote au clavier
  useEffect(() => {
    const options = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    const active = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    ;(active ?? options?.[0])?.focus()
  }, [])

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation()
      closeMenu()
      return
    }
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const index = options.indexOf(document.activeElement as HTMLElement)
    const move = (to: number) => {
      event.preventDefault()
      options[(to + options.length) % options.length]?.focus()
    }
    if (event.key === "ArrowDown") move(index + 1)
    else if (event.key === "ArrowUp") move(index - 1)
    else if (event.key === "Home") move(0)
    else if (event.key === "End") move(options.length - 1)
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden="true" />
      <div onKeyDown={handleKeyDown} className="absolute bottom-full right-0 mb-2 z-50 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden">
        {availableModels.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Aucun modèle disponible.<br />Vérifiez qu'Ollama est lancé.
            </p>
          </div>
        ) : (
          <div ref={listRef} role="listbox" aria-label="Modèles" className="p-1 max-h-64 overflow-y-auto">
            {availableModels.map((modelName) => (
              <button
                key={modelName}
                role="option"
                aria-selected={modelName === activeModel}
                onClick={() => {
                  changeModel(modelName)
                  closeMenu()
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  modelName === activeModel
                    ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                <span className="truncate">{modelName}</span>
                {modelName === activeModel && <CheckIcon />}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export default Popup
