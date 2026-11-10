// Estimation du nombre de tokens à partir du nombre de caractères.
// Le ratio par défaut (~3,6 caractères par token) est celui du français mêlé de code ; dès qu'Ollama a renvoyé
// une mesure réelle (prompt_eval_count), on le recalcule à partir d'elle (voir `ratioFrom`).

export const DEFAULT_CHARS_PER_TOKEN = 3.6
const MIN_RATIO = 2.2
const MAX_RATIO = 6

// Surcoût fixe par message (balises de rôle du modèle de chat)
export const MESSAGE_OVERHEAD_TOKENS = 6

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_CHARS_PER_TOKEN
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

export function estimateTokens(chars: number, ratio: number = DEFAULT_CHARS_PER_TOKEN): number {
  return Math.ceil(Math.max(0, chars) / clampRatio(ratio))
}

// Mesure réelle d'une requête précédente : tokens du prompt côté Ollama et caractères envoyés
export interface Calibration {
  tokens: number
  chars: number
}

export function ratioFrom(calibration: Calibration | undefined): number {
  if (!calibration || calibration.tokens <= 0 || calibration.chars <= 0) return DEFAULT_CHARS_PER_TOKEN
  return clampRatio(calibration.chars / calibration.tokens)
}
