// Statistiques minimales pour comparer des variantes de prompt

export interface Proportion {
  successes: number
  n: number
  rate: number
  low: number   // borne basse de l'intervalle de confiance à 95 % (méthode de Wilson)
  high: number
}

// Intervalle de Wilson : fiable même avec peu d'essais ou des taux proches de 0 % / 100 %
export function wilson(successes: number, n: number, z = 1.96): Proportion {
  if (n === 0) return { successes, n, rate: 0, low: 0, high: 0 }
  const p = successes / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator
  return { successes, n, rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) }
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Deux intervalles qui ne se chevauchent pas : la différence est significative (test prudent)
export function clearlyDifferent(a: Proportion, b: Proportion): boolean {
  return a.low > b.high || b.low > a.high
}

export function percent(p: number): string {
  return `${Math.round(p * 100)} %`
}
