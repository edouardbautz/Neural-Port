// Les petits modèles oublient souvent de fermer un bloc de code. En Markdown, un bloc resté ouvert
// avale tout le reste de la réponse (texte, liste, blocs suivants), qui s'affiche alors comme du code.
// Une ligne « ```bash » ne peut jamais fermer un bloc (une fermeture n'a pas de langage) : si elle apparaît
// alors qu'un bloc est ouvert, c'est que le modèle a oublié de le fermer. On le ferme juste avant.
export function repairFences(markdown: string): string {
  const out: string[] = []
  let open: { char: string; len: number } | null = null
  let justClosed = false // la ligne précédente était une fermeture de bloc

  for (const line of markdown.split("\n")) {
    const m = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line)
    if (m) {
      const char = m[1][0]
      const len = m[1].length
      const info = m[2].trim()
      if (open === null) {
        if (justClosed && info === "") {
          // « ``` » nu collé à une fermeture : fence parasite, qui ouvrirait un bloc jusqu'à la fin de la réponse
          justClosed = false
          continue
        }
        open = { char, len }
        justClosed = false
      } else if (char === open.char && len >= open.len && info === "") {
        open = null // vraie fermeture
        justClosed = true
      } else if (char === open.char && len === open.len && info !== "") {
        out.push(open.char.repeat(open.len)) // fermeture oubliée : on la rajoute
        open = { char, len }
      }
    } else if (line.trim() !== "") {
      justClosed = false
    }
    out.push(line)
  }
  return out.join("\n")
}
