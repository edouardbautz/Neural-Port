import { useEffect, useRef, useState } from "react"
import { XIcon } from "./icons"
import { normalizeOllamaUrl } from "../lib/ollama"
import StepSlider from "./StepSlider"
import { THRESHOLDS, type CompactionSettings, type ConversationSummary } from "../lib/compaction"
import { ctxSteps, THINK_LEVELS, type ThinkLevel } from "../lib/context"
import { TEMPERATURE_LEVELS, type TemperatureLevel } from "../lib/temperature"
import { instructionsTokens, MAX_INSTRUCTIONS_CHARS, normalizeInstructions } from "../lib/instructions"

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
  busy: boolean                        // une génération ou une compaction est en cours
  nextEstimate: number | null          // taille estimée du prochain prompt (tokens)
  effectiveCtx: number
  onCompactNow: () => void
  onClearSummary: () => void
  thinkLevel: ThinkLevel
  thinkSupport: "none" | "toggle" | "levels"  // ce que le modèle sait faire
  onThinkChange: (value: ThinkLevel) => void
  temperatureLevel: TemperatureLevel
  onTemperatureChange: (value: TemperatureLevel) => void
  customInstructions: string
  onCustomInstructionsChange: (value: string) => void
  ollamaUrl: string
  defaultOllamaUrl: string
  connection: "checking" | "ok" | "down"
  onOllamaUrlChange: (value: string) => string | null  // renvoie un message d'erreur si l'adresse est invalide
  conversationCount: number
  onExport: () => void
  onImport: (text: string) => { ok: boolean; message: string }
  onClose: () => void
}

function SettingsPanel({ numCtx, maxCtx, used, onChange, compaction, onCompactionChange, summary, canCompact, busy, nextEstimate, effectiveCtx, onCompactNow, onClearSummary, thinkLevel, thinkSupport, onThinkChange, temperatureLevel, onTemperatureChange, customInstructions, onCustomInstructionsChange, ollamaUrl, defaultOllamaUrl, connection, onOllamaUrlChange, conversationCount, onExport, onImport, onClose }: SettingsPanelProps) {
  const [urlDraft, setUrlDraft] = useState(ollamaUrl)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Le panneau s'ouvre sur une action de l'utilisateur : le focus y entre, Échap le referme (sauf pendant une génération, où Échap l'arrête)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  useEffect(() => {
    if (busy) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [busy, onClose])

  function applyUrl() {
    const error = onOllamaUrlChange(urlDraft)
    setUrlError(error)
    if (!error) setUrlDraft(normalizeOllamaUrl(urlDraft) ?? defaultOllamaUrl)
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      setImportStatus(onImport(await file.text()))
    } catch {
      setImportStatus({ ok: false, message: "Impossible de lire ce fichier." })
    }
    if (fileRef.current) fileRef.current.value = ""
  }

  const steps = ctxSteps(maxCtx)
  // Palier le plus proche de la valeur enregistrée
  const index = steps.reduce((best, s, i) => (Math.abs(s - numCtx) < Math.abs(steps[best] - numCtx) ? i : best), 0)
  const current = steps[index]
  const thinkIndex = THINK_LEVELS.findIndex(l => l.id === thinkLevel)
  const thinkInfo = THINK_LEVELS[thinkIndex]
  const temperatureIndex = Math.max(0, TEMPERATURE_LEVELS.findIndex(l => l.id === temperatureLevel))
  const temperatureInfo = TEMPERATURE_LEVELS[temperatureIndex]
  const usedPct = used != null ? Math.min(100, (used / current) * 100) : null

  return (
    <aside aria-label="Paramètres" className="fixed inset-y-0 right-0 z-30 w-full sm:w-96 lg:static lg:z-auto shrink-0 flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 msg-in">
      <div className="shrink-0 flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-semibold">Paramètres</span>
        <button
          ref={closeRef}
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
            <span className="text-sm font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
              {current.toLocaleString("fr-FR")} <span className="text-zinc-600 dark:text-zinc-400 font-normal">tokens</span>
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
            <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">{thinkInfo.label}</span>
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
            <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              Ce modèle ne gère que « réfléchir ou non » : les niveaux sont appliqués par l'application, qui interrompt la
              réflexion au-delà de la durée prévue puis demande une réponse directe.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="temperature" className="text-sm font-medium">Température</label>
            <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              {temperatureInfo.label} <span className="font-normal text-zinc-600 dark:text-zinc-400">({temperatureInfo.value.toLocaleString("fr-FR")})</span>
            </span>
          </div>

          <StepSlider
            id="temperature"
            labels={TEMPERATURE_LEVELS.map(l => l.label)}
            index={temperatureIndex}
            onChange={i => onTemperatureChange(TEMPERATURE_LEVELS[i].id)}
          />

          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{temperatureInfo.description}</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="custom-instructions" className="text-sm font-medium">Instructions personnalisées</label>
            <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
              {normalizeInstructions(customInstructions).length} / {MAX_INSTRUCTIONS_CHARS} · ≈ {instructionsTokens(customInstructions)} tokens
            </span>
          </div>
          <textarea
            id="custom-instructions"
            value={customInstructions}
            onChange={e => onCustomInstructionsChange(e.target.value.slice(0, MAX_INSTRUCTIONS_CHARS * 2))}
            rows={4}
            spellCheck
            placeholder="Ex. : Tutoie-moi. Je suis développeur Python débutant : donne toujours des exemples en Python."
            aria-describedby="custom-instructions-help"
            className="w-full resize-y px-3 py-2 rounded-lg text-sm leading-relaxed bg-zinc-100 dark:bg-zinc-800 placeholder-zinc-500 dark:placeholder-zinc-400 outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <div className="flex items-start justify-between gap-3">
            <p id="custom-instructions-help" className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              Ajoutées au prompt système à chaque message et prioritaires sur ses règles générales. Elles comptent dans la fenêtre de contexte : restez bref.
            </p>
            {customInstructions && (
              <button
                onClick={() => onCustomInstructionsChange("")}
                className="shrink-0 px-2 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors"
              >
                Effacer
              </button>
            )}
          </div>
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
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{Math.round(compaction.threshold * 100)} % de la fenêtre</span>
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
              className="px-3 py-2 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              Compacter maintenant
            </button>
            {summary && (
              <button
                onClick={onClearSummary}
                disabled={busy}
                title="Le modèle reverra tous les messages d'origine à la place du résumé"
                className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-40 disabled:hover:text-zinc-500 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                Supprimer le résumé
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
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Disponible après la première réponse.</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="ollama-url" className="text-sm font-medium">Adresse d'Ollama</label>
            <span className={`text-xs font-medium ${connection === "ok" ? "text-emerald-700 dark:text-emerald-400" : connection === "down" ? "text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>
              {connection === "ok" ? "Connecté" : connection === "down" ? "Injoignable" : "Connexion…"}
            </span>
          </div>
          <input
            id="ollama-url"
            value={urlDraft}
            onChange={e => { setUrlDraft(e.target.value); setUrlError(null) }}
            onBlur={applyUrl}
            onKeyDown={e => { if (e.key === "Enter") applyUrl() }}
            disabled={busy}
            spellCheck={false}
            placeholder={defaultOllamaUrl}
            aria-invalid={urlError != null}
            className="w-full px-3 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-800 placeholder-zinc-500 dark:placeholder-zinc-400 outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
          />
          {urlError && <p role="alert" className="text-xs text-red-500">{urlError}</p>}
          <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Par défaut {defaultOllamaUrl}. Pour joindre Ollama depuis une autre adresse, démarre-le avec la variable <code>OLLAMA_ORIGINS</code> (voir le README).
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Données</span>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Tes conversations sont conservées dans ce navigateur uniquement. Exporte-les pour les sauvegarder ou les retrouver sur un autre navigateur.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onExport}
              disabled={conversationCount === 0}
              className="px-3 py-2 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              Exporter ({conversationCount})
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              Importer…
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => void handleFile(e.target.files?.[0])} />
          </div>
          {importStatus && (
            <p role="status" className={`text-xs ${importStatus.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{importStatus.message}</p>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {maxCtx ? `Maximum du modèle : ${maxCtx.toLocaleString("fr-FR")} tokens. ` : ""}
          Le changement s'applique au prochain message ; Ollama recharge alors le modèle.
        </p>
      </div>
    </aside>
  )
}

export default SettingsPanel
