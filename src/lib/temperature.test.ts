import { describe, expect, it } from "vitest"
import { DEFAULT_TEMPERATURE_LEVEL, isTemperatureLevel, TEMPERATURE_LEVELS, temperatureValue } from "./temperature"

describe("températures", () => {
  it("propose des niveaux croissants, de 0,2 à 1", () => {
    const values = TEMPERATURE_LEVELS.map(l => l.value)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(values[0]).toBe(0.2)
    expect(values.at(-1)).toBe(1)
  })
  it("a un niveau par défaut valide, plus bas que le réglage du modèle", () => {
    expect(isTemperatureLevel(DEFAULT_TEMPERATURE_LEVEL)).toBe(true)
    expect(temperatureValue(DEFAULT_TEMPERATURE_LEVEL)).toBe(0.4)
  })
  it("rejette une valeur mémorisée inconnue", () => {
    expect(isTemperatureLevel("chaud")).toBe(false)
    expect(isTemperatureLevel(null)).toBe(false)
    expect(isTemperatureLevel(0.4)).toBe(false)
  })
  it("renvoie la valeur du niveau, ou le défaut si le niveau est inconnu", () => {
    expect(temperatureValue("creative")).toBe(1)
    expect(temperatureValue("inconnu" as never)).toBe(0.4)
  })
})
