import { describe, expect, it } from 'vitest'
import { normalizeQty, parseTypedQty } from './quantity'

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

describe('parseTypedQty', () => {
  const cases: Array<[string, number | null]> = [
    ['', null],
    ['  ', null],
    ['0', null],
    ['-2', null],
    ['abc', null],
    ['1.', 1],
    ['1.5', 1.5],
    [' 2 ', 2],
    ['1.234', 1.234], // 打字途中不捨入，捨入留給 normalizeQty
  ]
  for (const [input, want] of cases) {
    it(`parseTypedQty(${JSON.stringify(input)}) === ${want}`, () => {
      expect(parseTypedQty(input)).toBe(want)
    })
  }
})
