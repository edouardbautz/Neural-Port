import { CheckIcon } from "./icons"

interface PopupProps {
  closeMenu: () => void
  changeModel: (modelName: string) => void
  availableModels: string[]
  activeModel?: string
}

function Popup({ closeMenu, changeModel, availableModels, activeModel }: PopupProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={closeMenu} />
      <div className="absolute bottom-full right-0 mb-2 z-50 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden">
        {availableModels.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
              Aucun modèle disponible.<br />Vérifiez qu'Ollama est lancé.
            </p>
          </div>
        ) : (
          <div className="p-1 max-h-64 overflow-y-auto">
            {availableModels.map((modelName) => (
              <button
                key={modelName}
                onClick={() => {
                  changeModel(modelName)
                  closeMenu()
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  modelName === activeModel
                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50'
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
