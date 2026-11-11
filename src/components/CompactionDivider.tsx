import { summaryBody, type ConversationSummary } from "../lib/compaction"

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })
}

// Repère affiché dans la conversation à l'endroit où les messages précédents ont été résumés
function CompactionDivider({ summary }: { summary: ConversationSummary }) {
  return (
    <details className="group/compact my-1 text-[11px] text-zinc-600 dark:text-zinc-400">
      <summary className="flex cursor-pointer select-none items-center gap-3 list-none [&::-webkit-details-marker]:hidden hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        <span className="text-center">
          Conversation compactée · {summary.messagesCovered} message{summary.messagesCovered > 1 ? "s" : ""} résumé{summary.messagesCovered > 1 ? "s" : ""}
          {" · "}≈ {fmt(summary.tokensBefore)} → ≈ {fmt(summary.tokensAfter)} tokens
          {summary.auto ? " · auto" : ""}
          <span className="ml-1.5 inline-block transition-transform group-open/compact:rotate-90">›</span>
        </span>
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </summary>
      <div className="mt-2 mx-auto max-w-[80%] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider">Résumé envoyé au modèle à la place des messages ci-dessus</p>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{summaryBody(summary)}</p>
      </div>
    </details>
  )
}

export default CompactionDivider
