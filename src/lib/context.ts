// Paliers proposés pour la fenêtre de contexte (en tokens)
const STEPS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144]

// Paliers disponibles pour un modèle (bornés par son contexte maximal, s'il est connu)
export function ctxSteps(max: number | null): number[] {
  const steps = STEPS.filter(s => max === null || s <= max)
  return steps.length > 0 ? steps : [STEPS[0]]
}
