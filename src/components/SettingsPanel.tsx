import { XIcon } from "./icons"
import StepSlider from "./StepSlider"
import { THRESHOLDS, type CompactionSettings, type ConversationSummary } from "../lib/compaction"
import { ctxSteps, THINK_LEVELS, type ThinkLevel } from "../lib/context"

function fmt(n: number): string {
  return n >= 1024 ? `${n / 1024}k` : String(n)
}

interface SettingsPanelProps {
  numCtx: number
  maxCtx: number | null  // contexte maximal du modèle (null si inconnu)
  used: number | null    // tokens utilisés lors de la dernière réponse
  onChange: (value: number) => void
  compaction: CompactionSettings
  onCompactionChange: (value: CompactionSettings) => void
  summary: ConversationSummary | null  // résumé de la conversation ouverte
  canCompact: boolean
  nextEstimate: number | null          // taille estimée du prochain prompt (tokens)
  effectiveCtx: number
  onCompactNow: () => void
  onClearSummary: () => void
  thinkLevel: ThinkLevel
  thinkSupport: "none" | "toggle" | "levels"  // ce que le modèle sait faire
  onThinkChange: (value: ThinkLevel) => void
  onClose: () => void
}

function SettingsPanel({ numCtx, maxCtx, used, onChange, compaction, onCompactionChange, summary, canCompact, nextEstimate, effectiveCtx, onCompactNow, onClearSummary, thinkLevel, thinkSupport, onThinkChange, onClose }: SettingsPanelProps) {
  const steps = ctxSteps(maxCtx)
  // Palier le plus proche de la valeur enregistrée
  const index = steps.reduce((best, s, i) => (Math.abs(s - numCtx) < Math.abs(steps[best] - numCtx) ? i : best), 0)
  const current = steps[index]
  const thinkIndex = THINK_LEVELS.findIndex(l => l.id === thinkLevel)
  const thinkInfo = THINK_LEVELS[thinkIndex]
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

          <StepSlider
            id="ctx"
            labels={steps.map(fmt)}
            index={index}
            onChange={i => onChange(steps[i])}
          />

          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            C'est la mémoire de travail du modèle : ta question, l'historique, sa réflexion et sa réponse doivent tenir dedans.
            Trop petite, il oublie le début de la conversation ou s'arrête en pleine réflexion.
            Plus grande, elle consomme plus de mémoire et ralentit le chargement du modèle.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="think" className="text-sm font-medium">Réflexion du modèle</label>
            <span className="text-sm font-semibold text-indigo-500">{thinkInfo.label}</span>
          </div>

          <StepSlider
            id="think"
            labels={THINK_LEVELS.map(l => l.label)}
            index={thinkIndex}
            disabled={thinkSupport === "none"}
            onChange={i => onThinkChange(THINK_LEVELS[i].id)}
          />

          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {thinkSupport === "none" ? "Ce modèle ne raisonne pas : ce réglage n'a pas d'effet." : thinkInfo.description}
          </p>
          {thinkSupport === "toggle" && (
            <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              Ce modèle ne gère que « réfléchir ou non » : les niveaux sont appliqués par l'application, qui interrompt la
              réflexion au-delà de la durée prévue puis demande une réponse directe.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Compaction automatique</span>
            <button
              role="switch"
              aria-checked={compaction.enabled}
              aria-label="Compaction automatique"
              onClick={() => onCompactionChange({ ...compaction, enabled: !compaction.enabled })}
              className={`relative w-10 h-6 shrink-0 rounded-full transition-colors cursor-pointer ${compaction.enabled ? "bg-indigo-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${compaction.enabled ? "translate-x-4" : ""}`} />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Quand la conversation approche de la limite de la fenêtre de contexte, les anciens messages sont résumés par le modèle
            et le résumé les remplace dans ce qui lui est envoyé. Tes messages restent affichés et conservés.
          </p>

          {compaction.enabled && (
            <>
              <div className="flex items-baseline justify-between">
                <label htmlFor="threshold" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Seuil de déclenchement</label>
                <span className="text-xs font-semibold text-indigo-500">{Math.round(compaction.threshold * 100)} % de la fenêtre</span>
              </div>
              <StepSlider
                id="threshold"
                labels={THRESHOLDS.map(t => `${Math.round(t * 100)} %`)}
                index={Math.max(0, THRESHOLDS.findIndex(t => Math.abs(t - compaction.threshold) < 0.001))}
                onChange={i => onCompactionChange({ ...compaction, threshold: THRESHOLDS[i] })}
              />
            </>
          )}

          {nextEstimate != null && (
            <div className="flex flex-col gap-1.5">
              <div className="relative h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${nextEstimate / effectiveCtx > compaction.threshold ? "bg-amber-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(100, (nextEstimate / effectiveCtx) * 100)}%` }}
                />
                {compaction.enabled && (
                  <span className="absolute top-0 bottom-0 w-px bg-zinc-500 dark:bg-zinc-300" style={{ left: `${compaction.threshold * 100}%` }} />
                )}
              </div>
              <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                Prochain message (estimation) : ≈ {nextEstimate.toLocaleString("fr-FR")} / {effectiveCtx.toLocaleString("fr-FR")} tokens
              </span>
            </div>
          )}

          {summary && (
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Conversation compactée : {summary.messagesCovered} message{summary.messagesCovered > 1 ? "s" : ""} résumé{summary.messagesCovered > 1 ? "s" : ""}
              {" "}(≈ {summary.tokensBefore.toLocaleString("fr-FR")} → ≈ {summary.tokensAfter.toLocaleString("fr-FR")} tokens).
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={onCompactNow}
              disabled={!canCompact}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              Compacter maintenant
            </button>
            {summary && (
              <button
                onClick={onClearSummary}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors"
              >
                Annuler la compaction
              </button>
            )}
          </div>
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
