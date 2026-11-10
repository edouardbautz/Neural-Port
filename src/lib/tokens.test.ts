import { describe, expect, it } from "vitest"
import { clampRatio, DEFAULT_CHARS_PER_TOKEN, estimateTokens, ratioFrom } from "./tokens"

describe("tokens", () => {
  it("estime à partir du ratio", () => {
    expect(estimateTokens(360, 3.6)).toBe(100)
    expect(estimateTokens(0)).toBe(0)
  })
  it("calcule le ratio d'une mesure réelle et le borne", () => {
    expect(ratioFrom({ tokens: 677, chars: 2880 })).toBeCloseTo(4.25, 1)
    expect(ratioFrom(undefined)).toBe(DEFAULT_CHARS_PER_TOKEN)
    expect(clampRatio(50)).toBe(6)
    expect(clampRatio(0.1)).toBe(2.2)
    expect(clampRatio(NaN)).toBe(DEFAULT_CHARS_PER_TOKEN)
  })
})
