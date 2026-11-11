// Niveaux de température proposés à l'utilisateur. Valeurs choisies d'après la courbe mesurée sur le banc d'évaluation
// (docs/prompt-engineering.md, section 8) : même prompt, même modèle, 88 % de réussite à 0,2, 86 % à 0,4, 75 % à 0,7, 67 % à 1,0.
export type TemperatureLevel = "precise" | "balanced" | "flexible" | "creative"

export const TEMPERATURE_LEVELS: { id: TemperatureLevel; label: string; value: number; description: string }[] = [
  { id: "precise", label: "Précis", value: 0.2, description: "Réponses les plus stables et factuelles : à privilégier pour le code, les faits et les consignes de forme." },
  { id: "balanced", label: "Équilibré", value: 0.4, description: "Presque aussi fiable que « Précis », avec un peu de variété dans les formulations. Réglage par défaut." },
  { id: "flexible", label: "Souple", value: 0.7, description: "Plus de variété, mais plus d'erreurs de forme et de faits (mesuré : environ 10 points de fiabilité en moins)." },
  { id: "creative", label: "Créatif", value: 1.0, description: "Réponses variées et imprévisibles, pour l'écriture et le brainstorming ; le moins fiable pour les faits et le code." }
]

export const DEFAULT_TEMPERATURE_LEVEL: TemperatureLevel = "balanced"

export function isTemperatureLevel(value: unknown): value is TemperatureLevel {
  return TEMPERATURE_LEVELS.some(l => l.id === value)
}

export function temperatureValue(level: TemperatureLevel): number {
  return (TEMPERATURE_LEVELS.find(l => l.id === level) ?? TEMPERATURE_LEVELS[1]).value
}
