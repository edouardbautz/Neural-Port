// Détection de la langue dominante d'un texte (français / anglais), d'après la fréquence des mots courants.
// Sert à choisir la langue des consignes données au modèle : chez un petit modèle, la langue du prompt dicte celle de la réponse.

const FR_WORDS = new Set("le la les des un une est et que qui pour dans je vous pas ce sur avec il elle nous à de du au aux en ne se sont mais ou donc car très cette ces son sa ses leur plus être avoir fait peut peux comme tout aussi si où par été ça c'est qu'il l'on n'est j'ai".split(" "))
const EN_WORDS = new Set("the and is are of to in that for with you it this not can have be as on was were will would your from or an by at but they we which what how do does if there their more about into than also should could".split(" "))

export type Language = "fr" | "en" | "unknown"

export function words(text: string): string[] {
  // Les blocs de code n'ont pas de langue naturelle : on les ignore
  return text.replace(/```[\s\S]*?```/g, " ").toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g) ?? []
}

// Langue dominante d'un texte, d'après la fréquence des mots courants. « unknown » si le texte est trop court.
export function detectLanguage(text: string): Language {
  const tokens = words(text)
  if (tokens.length < 4) return "unknown"
  let fr = 0
  let en = 0
  for (const w of tokens) {
    if (FR_WORDS.has(w)) fr++
    if (EN_WORDS.has(w)) en++
  }
  if (fr + en < 2) return "unknown"
  if (fr >= en * 1.5) return "fr"
  if (en >= fr * 1.5) return "en"
  return "unknown"
}

