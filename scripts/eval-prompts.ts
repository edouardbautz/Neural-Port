import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { CASES, CUSTOM_CASES, EVAL_MODEL, FILE_CASES, EVAL_NOW, gradeReply, HELD_OUT_CASES, makeReply } from "../src/eval/cases"
import { markdownReport, summarize, worstCases } from "../src/eval/report"
import { ollamaChat, runAll, type RunOptions } from "../src/eval/runner"
import { runSummaryTrial, SUMMARY_CASES, SUMMARY_VARIANTS, summarizeSummaryTrials, summaryMarkdown, type SummaryTrial } from "../src/eval/summary"
import type { TrialResult } from "../src/eval/types"
import { BASELINE, VARIANTS } from "../src/eval/variants"

// Usage : npm run eval:prompts -- --variants reference,fr-complet --samples 3 --out resultats.jsonl
// Rapport seul : npm run eval:prompts -- --report resultats.jsonl

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? "true" : argv[++i]
  return out
}

const a = args(process.argv.slice(2))
const suite = a.suite ?? "prompts"
const baseUrl = a.url ?? "http://localhost:11434"
const model = a.model ?? EVAL_MODEL
const ids = (a.variants ?? Object.keys(VARIANTS).join(",")).split(",").filter(Boolean)
const variants = suite === "summary" ? [] : ids.map(id => VARIANTS[id] ?? (() => { throw new Error(`Variante inconnue : ${id} (disponibles : ${Object.keys(VARIANTS).join(", ")})`) })())
const pool = a.files === "true" ? FILE_CASES : a.custom === "true" ? CUSTOM_CASES : a["held-out"] === "true" ? HELD_OUT_CASES : CASES
const cases = a.cases ? pool.filter(c => a.cases.split(",").some(p => c.id.startsWith(p))) : pool

function printReport(results: TrialResult[]) {
  const summaries = summarize(results, variants.length ? variants : Object.values(VARIANTS), BASELINE.id)
  console.log("\n" + markdownReport(summaries, BASELINE.id))
  for (const s of summaries) {
    const worst = worstCases(results, s.id, 5)
    if (worst.length) console.log(`\n${s.id} — cas les plus ratés : ${worst.map(w => `${w.caseId} (${w.fails}/${w.n}: ${w.failedChecks.join(", ")})`).join(" ; ")}`)
  }
  const errors = results.filter(r => r.error).length
  if (errors) console.log(`\n⚠ ${errors} appel(s) en erreur, exclus des taux.`)
}

async function runSummarySuite() {
  const samples = Number(a.samples ?? 3)
  const chosen = a.variants ? SUMMARY_VARIANTS.filter(v => a.variants.split(",").includes(v.id)) : SUMMARY_VARIANTS
  if (a.report) {
    const trials = readFileSync(a.report, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as SummaryTrial)
    console.log("\n" + summaryMarkdown(summarizeSummaryTrials(trials, chosen)))
    return
  }
  const info = (await (await fetch(`${baseUrl}/api/show`, { method: "POST", body: JSON.stringify({ model }) })).json()) as { capabilities?: string[] }
  const chat = ollamaChat(baseUrl, { thinkOff: info.capabilities?.includes("thinking") ?? false })
  if (a.out) writeFileSync(a.out, "")
  console.log(`Évaluation du résumé : modèle ${model} · ${chosen.length} variantes × ${SUMMARY_CASES.length} conversations × ${samples} essais`)
  const trials: SummaryTrial[] = []
  for (let sample = 0; sample < samples; sample++)
    for (const c of SUMMARY_CASES)
      for (const v of chosen) {
        const t = await runSummaryTrial(chat, v, c, sample, model, Number(a.seed ?? 2000))
        trials.push(t)
        if (a.out) appendFileSync(a.out, JSON.stringify(t) + "\n")
      }
  console.log("\n" + summaryMarkdown(summarizeSummaryTrials(trials, chosen)))
  for (const v of chosen) {
    const bad = trials.filter(t => t.variant === v.id && !t.pass).slice(0, 4)
    if (bad.length) console.log(`\n${v.id} — échecs : ${bad.map(t => `${t.caseId} (${Object.entries(t.checks).filter(([, ok]) => !ok).map(([k]) => k).join(", ") || "vide"}${t.missing.length ? " ; manque : " + t.missing.join("/") : ""})`).join(" ; ")}`)
  }
}

// Re-note des essais déjà enregistrés avec les correcteurs actuels (sans interroger le modèle)
function regrade(file: string): TrialResult[] {
  const env = { now: EVAL_NOW, model }
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => {
    const t = JSON.parse(line) as TrialResult
    const testCase = [...CASES, ...HELD_OUT_CASES, ...CUSTOM_CASES, ...FILE_CASES].find(c => c.id === t.caseId)
    if (!testCase || t.error) return t
    const checks = gradeReply(testCase, makeReply({ content: t.content, toolCalls: t.toolCalls }), env)
    return { ...t, checks, pass: Object.values(checks).every(Boolean) }
  })
}

if (suite === "summary") {
  await runSummarySuite()
} else if (a.regrade) {
  const results = regrade(a.regrade)
  if (a.out) writeFileSync(a.out, results.map(r => JSON.stringify(r)).join("\n") + "\n")
  const present = [...new Set(results.map(r => r.variant))]
  variants.splice(0, variants.length, ...present.map(id => VARIANTS[id]).filter(Boolean))
  printReport(results)
} else if (a.report) {
  const results = readFileSync(a.report, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as TrialResult)
  printReport(results)
} else {
  const options: RunOptions = {
    model, temperature: a.temperature === "default" ? Number.NaN : Number(a.temperature ?? 0.2), seedBase: Number(a.seed ?? 1000), numPredict: Number(a["num-predict"] ?? 400), numCtx: Number(a["num-ctx"] ?? 4096)
  }
  const samples = Number(a.samples ?? 2)
  const info = (await (await fetch(`${baseUrl}/api/show`, { method: "POST", body: JSON.stringify({ model }) })).json()) as { capabilities?: string[] }
  const chat = ollamaChat(baseUrl, { thinkOff: (info.capabilities?.includes("thinking") ?? false) && a.think !== "true" })
  if (a.out) writeFileSync(a.out, "")
  console.log(`Évaluation : modèle ${model} · ${variants.length} variantes × ${cases.length} cas × ${samples} essais · température ${Number.isNaN(options.temperature) ? "par défaut du modèle" : options.temperature} · réflexion ${a.think === "true" ? "activée" : "désactivée"}`)
  const results = await runAll(chat, variants, cases, samples, { now: EVAL_NOW, model }, options, (trial, done, total) => {
    if (a.out) appendFileSync(a.out, JSON.stringify(trial) + "\n")
    if (done % 20 === 0 || done === total) console.log(`  ${done}/${total}`)
  })
  printReport(results)
}
