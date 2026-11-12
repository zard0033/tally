import { describe, expect, it } from 'vitest'
import { formatUsd } from './aiModels'

describe('aiModels', () => {
  it('formatUsd：取到分；null 是「—」', () => {
    expect(formatUsd(7.5)).toBe('$7.50')
    expect(formatUsd(0.004)).toBe('$0.00')
    expect(formatUsd(12.345)).toBe('$12.35')
    expect(formatUsd(null)).toBe('—')
  })
})
