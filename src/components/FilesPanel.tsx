import { useState } from "react"
import { downloadFile, type GeneratedFile } from "../lib/files"
import { XIcon } from "./icons"

interface FilesPanelProps {
  files: GeneratedFile[]
  onClose: () => void
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function FilesPanel({ files, onClose }: FilesPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = files.find(f => f.id === selectedId) ?? null

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full sm:w-96 lg:static lg:z-auto shrink-0 flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 msg-in">
      <div className="shrink-0 flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-semibold">
          Fichiers générés <span className="text-zinc-400 dark:text-zinc-500 font-normal">({files.length})</span>
        </span>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          aria-label="Fermer"
        >
          <XIcon />
        </button>
      </div>

      <ul className={`overflow-y-auto p-2 flex flex-col gap-1 ${selected ? "max-h-[40%] shrink-0 border-b border-zinc-200 dark:border-zinc-800" : "flex-1"}`}>
        {files.map(file => (
          <li key={file.id}>
            <div
              className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                file.id === selectedId ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <button
                onClick={() => setSelectedId(file.id === selectedId ? null : file.id)}
                className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
              >
                <span className="text-zinc-400 dark:text-zinc-500"><FileIcon /></span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{file.name}</span>
                  <span className="block text-[11px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    {file.lang} · {file.content.split("\n").length - 1} lignes
                  </span>
                </span>
              </button>
              <button
                onClick={() => downloadFile(file)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-indigo-500 hover:bg-white dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                aria-label={`Télécharger ${file.name}`}
                title="Télécharger"
              >
                <DownloadIcon />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {selected && (
        <pre className="flex-1 min-h-0 overflow-auto p-3.5 text-[12px] leading-relaxed bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">
          <code>{selected.content}</code>
        </pre>
      )}
    </aside>
  )
}

export default FilesPanel
