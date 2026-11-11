interface StepSliderProps {
  id: string
  labels: string[]
  index: number
  onChange: (index: number) => void
  disabled?: boolean
}

const THUMB = 16 // px : doit rester identique à la taille du curseur définie dans index.css (.np-range)

// Position (centre du curseur) du palier i : le curseur natif ne va jamais jusqu'au bord, il est décalé d'un demi-curseur
function stepLeft(i: number, count: number): string {
  const ratio = count > 1 ? i / (count - 1) : 0
  return `calc(${THUMB / 2}px + ${ratio} * (100% - ${THUMB}px))`
}

// Curseur à paliers avec graduations et libellés alignés exactement sous chaque position du curseur
function StepSlider({ id, labels, index, onChange, disabled = false }: StepSliderProps) {
  return (
    <div className={`px-2 ${disabled ? "opacity-40" : ""}`}>
      <div className="relative">
        <input
          id={id}
          type="range"
          min={0}
          max={labels.length - 1}
          step={1}
          value={index}
          disabled={disabled}
          onChange={e => onChange(Number(e.target.value))}
          className="np-range"
          style={{ ["--fill" as string]: stepLeft(index, labels.length) }}
        />
        {/* Graduations */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
          {labels.map((_, i) => (
            <span
              key={i}
              className={`absolute top-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                i <= index ? "bg-white/70" : "bg-zinc-400/70 dark:bg-zinc-600"
              }`}
              style={{ left: stepLeft(i, labels.length) }}
            />
          ))}
        </div>
      </div>

      <div className="relative mt-2 h-4 select-none">
        {labels.map((label, i) => (
          <span
            key={label}
            className={`absolute -translate-x-1/2 text-[10px] tabular-nums whitespace-nowrap ${
              i === index ? "font-semibold text-indigo-600 dark:text-indigo-400" : "text-zinc-600 dark:text-zinc-400"
            }`}
            style={{ left: stepLeft(i, labels.length) }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default StepSlider
