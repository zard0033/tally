import { describe, expect, it } from 'vitest'
import { normalizeQty } from './quantity'

describe('normalizeQty', () => {
  const cases: Array<[unknown, number]> = [
    ['', 1],
    ['0', 1],
    ['-2', 1],
    ['abc', 1],
    ['1.5', 1.5],
    ['2', 2],
  ]
  for (const [input, want] of cases) {
    it(`normalizeQty(${JSON.stringify(input)}) === ${want}`, () => {
      expect(normalizeQty(input)).toBe(want)
    })
  }
})
