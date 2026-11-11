export interface GeneratedFile {
  id: string
  name: string
  lang: string
  content: string
}

const EXTENSIONS: Record<string, string> = {
  javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", html: "html", css: "css", scss: "scss", json: "json",
  yaml: "yml", yml: "yml", toml: "toml", xml: "xml", markdown: "md", md: "md",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", c: "c", cpp: "cpp", "c++": "cpp",
  csharp: "cs", cs: "cs", java: "java", go: "go", rust: "rs", rs: "rs", php: "php",
  ruby: "rb", rb: "rb", sql: "sql", swift: "swift", kotlin: "kt", lua: "lua",
  dockerfile: "Dockerfile", makefile: "Makefile", diff: "diff", ini: "ini", csv: "csv",
}

const KNOWN_EXTENSIONS = new Set([...Object.values(EXTENSIONS).map(e => e.toLowerCase()), "txt", "log", "env", "gitignore", "lock", "h", "hpp", "pl", "r", "dart", "vue", "svelte", "svg", "tsv", "cfg", "conf", "bat", "ps1"])

export function extensionFor(lang: string | null): string {
  return (lang && EXTENSIONS[lang.toLowerCase()]) || "txt"
}

function safeName(name: string): string {
  return name.replace(/^[./]+/, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "fichier.txt"
}

// Construit un fichier à partir d'un appel d'outil ou d'un bloc de code ; le nom est rendu unique
export function makeFile(name: string, content: string, lang: string | null, existing: GeneratedFile[]): GeneratedFile {
  let finalName = safeName(name)
  const taken = new Set(existing.map(f => f.name))
  if (taken.has(finalName)) {
    const dot = finalName.lastIndexOf(".")
    const base = dot > 0 ? finalName.slice(0, dot) : finalName
    const ext = dot > 0 ? finalName.slice(dot) : ""
    let n = 2
    while (taken.has(`${base} (${n})${ext}`)) n++
    finalName = `${base} (${n})${ext}`
  }
  const ext = finalName.includes(".") ? finalName.split(".").pop()! : ""
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: finalName,
    lang: ext || lang || "text",
    content: content.endsWith("\n") ? content : content + "\n",
  }
}

export function downloadFile(file: GeneratedFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Révoquer tout de suite peut annuler le téléchargement sur certains navigateurs
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface CodeBlock {
  lang: string | null
  code: string
}

// Blocs de code *terminés* (fence fermé) d'un texte markdown
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const lines = markdown.split("\n")
  const blocks: CodeBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(lines[i])
    if (!open) continue
    const marker = open[1]
    const end = lines.findIndex((l, j) => j > i && new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(l))
    if (end === -1) break
    const code = lines.slice(i + 1, end).join("\n")
    if (code.trim()) blocks.push({ lang: open[2] || null, code })
    i = end
  }
  return blocks
}

// Nom de fichier cité dans une demande utilisateur (ex. « crée main.py »)
// « Node.js », « Vue.js »… sont des noms de technologies, pas des fichiers
const JS_FRAMEWORKS = new Set(["node", "next", "nuxt", "vue", "react", "express", "angular", "ember", "backbone", "d3", "three", "p5", "chart", "socket", "nest", "alpine", "knockout", "moment", "require", "handlebars", "mocha", "underscore", "lodash", "meteor", "svelte", "solid", "preact", "electron"])

export function filenameFromRequest(text: string): string | null {
  const re = /(?:^|[\s`"'(])([\w-][\w./-]*\.([A-Za-z][A-Za-z0-9]{0,7}))(?=$|[\s`"'),.;:!?])/g
  for (const m of text.matchAll(re)) {
    if (!KNOWN_EXTENSIONS.has(m[2].toLowerCase())) continue
    if (m[2].toLowerCase() === "js" && JS_FRAMEWORKS.has(m[1].slice(0, -3).toLowerCase())) continue
    return m[1]
  }
  return null
}

const FILE_WORDS = /fichier|\bfiles?\b|télécharg|telecharg|download|exporte/i

// Le message demande-t-il un fichier ? (mot-clé, ou nom de fichier cité)
export function isFileRequest(text: string): boolean {
  return FILE_WORDS.test(text) || filenameFromRequest(text) !== null
}
