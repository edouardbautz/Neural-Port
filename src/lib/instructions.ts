// Instructions personnalisées de l'utilisateur, ajoutées au prompt système.
// Elles coûtent des tokens à chaque message : la taille est plafonnée et affichée dans les Paramètres.

export const MAX_INSTRUCTIONS_CHARS = 800
const CHARS_PER_TOKEN = 3.6

// Nettoie le texte saisi : retours à la ligne uniformes, pas de blocs de lignes vides, espaces de fin retirés, taille plafonnée
export function normalizeInstructions(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_INSTRUCTIONS_CHARS)
    .trimEnd()
}

export function instructionsTokens(text: string): number {
  return Math.ceil(normalizeInstructions(text).length / CHARS_PER_TOKEN)
}
