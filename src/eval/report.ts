import { mean, median, percent, wilson, clearlyDifferent, type Proportion } from "./stats"
import type { Category, PromptVariant, TrialResult } from "./types"

export interface VariantSummary {
  id: string
  label: string
  trials: number
  errors: number
  overall: Proportion
  byCategory: Record<string, Proportion>
  filler: Proportion
  thinkLeak: Proportion
  medianChars: number
  meanOutputTokens: number
  systemTokens: number     // taille du prompt système (tokens), estimée par différence avec la variante sans prompt
  medianMs: number
}

export function summarize(results: TrialResult[], variants: PromptVariant[], baselineId: string): VariantSummary[] {
  const promptTokensOf = (id: string) => mean(results.filter(r => r.variant === id && !r.error).map(r => r.promptTokens))
  // Même jeu de cas pour toutes les variantes : la différence de tokens de prompt avec la référence isole le coût du prompt système.
  // Sans variante de référence dans la série, on prend la plus légère comme point de comparaison (coût relatif).
  const hasBaseline = results.some(r => r.variant === baselineId)
  const base = hasBaseline ? promptTokensOf(baselineId) : Math.min(...variants.map(v => promptTokensOf(v.id)))
  return variants.map(v => {
    const mine = results.filter(r => r.variant === v.id)
    const ok = mine.filter(r => !r.error)
    const cats = [...new Set(mine.map(r => r.category))] as Category[]
    const byCategory: Record<string, Proportion> = {}
    for (const c of cats) {
      const inCat = ok.filter(r => r.category === c)
      byCategory[c] = wilson(inCat.filter(r => r.pass).length, inCat.length)
    }
    return {
      id: v.id, label: v.label, trials: mine.length, errors: mine.length - ok.length,
      overall: wilson(ok.filter(r => r.pass).length, ok.length),
      byCategory,
      filler: wilson(ok.filter(r => r.filler).length, ok.length),
      thinkLeak: wilson(ok.filter(r => r.thinkLeak).length, ok.length),
      medianChars: median(ok.map(r => r.chars)),
      meanOutputTokens: mean(ok.map(r => r.outputTokens)),
      systemTokens: Math.max(0, Math.round(promptTokensOf(v.id) - base)),
      medianMs: median(ok.map(r => r.ms))
    }
  })
}

const cell = (p: Proportion) => `${percent(p.rate)} [${percent(p.low)}–${percent(p.high)}]`

export function markdownReport(summaries: VariantSummary[], baselineId: string): string {
  const cats = [...new Set(summaries.flatMap(s => Object.keys(s.byCategory)))]
  const base = summaries.find(s => s.id === baselineId)
  const lines: string[] = []
  lines.push("| Variante | Réussite globale | Réponses creuses | Médiane (car.) | Coût du prompt (tokens) |")
  lines.push("|---|---|---|---|---|")
  for (const s of summaries) {
    const sig = base && s.id !== base.id && clearlyDifferent(s.overall, base.overall) ? (s.overall.rate > base.overall.rate ? " ▲" : " ▼") : ""
    lines.push(`| \`${s.id}\` | **${cell(s.overall)}**${sig} | ${percent(s.filler.rate)} | ${Math.round(s.medianChars)} | ${s.systemTokens} |`)
  }
  lines.push("")
  lines.push(`| Catégorie | ${summaries.map(s => `\`${s.id}\``).join(" | ")} |`)
  lines.push(`|---|${summaries.map(() => "---").join("|")}|`)
  for (const c of cats) lines.push(`| ${c} | ${summaries.map(s => (s.byCategory[c] ? percent(s.byCategory[c].rate) : "–")).join(" | ")} |`)
  return lines.join("\n")
}

// Cas qui échouent le plus souvent pour une variante (pour comprendre, pas seulement mesurer)
export function worstCases(results: TrialResult[], variantId: string, limit = 8): { caseId: string; fails: number; n: number; failedChecks: string[] }[] {
  const byCase = new Map<string, TrialResult[]>()
  for (const r of results.filter(x => x.variant === variantId && !x.error)) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r])
  return [...byCase.entries()]
    .map(([caseId, rs]) => ({
      caseId, fails: rs.filter(r => !r.pass).length, n: rs.length,
      failedChecks: [...new Set(rs.flatMap(r => Object.entries(r.checks).filter(([, ok]) => !ok).map(([k]) => k)))]
    }))
    .filter(c => c.fails > 0)
    .sort((a, b) => b.fails / b.n - a.fails / a.n)
    .slice(0, limit)
}
