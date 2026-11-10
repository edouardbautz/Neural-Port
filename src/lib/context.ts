// Paliers proposés pour la fenêtre de contexte (en tokens)
const STEPS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144]

// Paliers disponibles pour un modèle (bornés par son contexte maximal, s'il est connu)
export function ctxSteps(max: number | null): number[] {
  const steps = STEPS.filter(s => max === null || s <= max)
  return steps.length > 0 ? steps : [STEPS[0]]
}

// Niveaux de réflexion proposés à l'utilisateur
export type ThinkLevel = "off" | "low" | "medium" | "high"

export const THINK_LEVELS: { id: ThinkLevel; label: string; description: string; budgetChars: number | null }[] = [
  { id: "off", label: "Off", description: "Aucune réflexion : la réponse arrive immédiatement.", budgetChars: 0 },
  { id: "low", label: "Low", description: "Réflexion brève (environ 400 tokens), pour rester rapide.", budgetChars: 1600 },
  { id: "medium", label: "Medium", description: "Bon équilibre entre précision et délai (environ 1 500 tokens).", budgetChars: 6000 },
  { id: "high", label: "High", description: "Réflexion approfondie, sans limite : pour les problèmes complexes, mais parfois très long.", budgetChars: null }
]

export function isThinkLevel(value: unknown): value is ThinkLevel {
  return THINK_LEVELS.some(l => l.id === value)
}
