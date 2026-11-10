import { XIcon } from "./icons"
import { ctxSteps } from "../lib/context"

function fmt(n: number): string {
  return n >= 1024 ? `${n / 1024}k` : String(n)
}

interface SettingsPanelProps {
  numCtx: number
  maxCtx: number | null  // contexte maximal du modèle (null si inconnu)
  used: number | null    // tokens utilisés lors de la dernière réponse
  onChange: (value: number) => void
  onClose: () => void
}

function SettingsPanel({ numCtx, maxCtx, used, onChange, onClose }: SettingsPanelProps) {
  const steps = ctxSteps(maxCtx)
  // Palier le plus proche de la valeur enregistrée
  const index = steps.reduce((best, s, i) => (Math.abs(s - numCtx) < Math.abs(steps[best] - numCtx) ? i : best), 0)
  const current = steps[index]
  const usedPct = used != null ? Math.min(100, (used / current) * 100) : null

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full sm:w-96 lg:static lg:z-auto shrink-0 flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 msg-in">
      <div className="shrink-0 flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-semibold">Paramètres</span>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          aria-label="Fermer"
        >
          <XIcon />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-5 overflow-y-auto">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="ctx" className="text-sm font-medium">Fenêtre de contexte</label>
            <span className="text-sm font-semibold tabular-nums text-indigo-500">
              {current.toLocaleString("fr-FR")} <span className="text-zinc-400 dark:text-zinc-500 font-normal">tokens</span>
            </span>
          </div>

          <input
            id="ctx"
            type="range"
            min={0}
            max={steps.length - 1}
            step={1}
            value={index}
            onChange={e => onChange(steps[Number(e.target.value)])}
            className="w-full accent-indigo-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums select-none">
            {steps.map(s => <span key={s}>{fmt(s)}</span>)}
          </div>

          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            C'est la mémoire de travail du modèle : ta question, l'historique, sa réflexion et sa réponse doivent tenir dedans.
            Trop petite, il oublie le début de la conversation ou s'arrête en pleine réflexion.
            Plus grande, elle consomme plus de mémoire et ralentit le chargement du modèle.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Utilisation (dernière réponse)</span>
          {usedPct != null && used != null ? (
            <>
              <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-500" : "bg-indigo-500"}`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {used.toLocaleString("fr-FR")} / {current.toLocaleString("fr-FR")} tokens ({Math.round(usedPct)} %)
              </span>
            </>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">Disponible après la première réponse.</span>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          {maxCtx ? `Maximum du modèle : ${maxCtx.toLocaleString("fr-FR")} tokens. ` : ""}
          Le changement s'applique au prochain message ; Ollama recharge alors le modèle.
        </p>
      </div>
    </aside>
  )
}

export default SettingsPanel
