import { describe, expect, it } from 'vitest'
import { dayIndex } from '@/lib/dates'
import { trendXAxis } from './trendAxis'

describe('trendXAxis', () => {
  it('有 domain 就用它，沒有退回 auto；刻度顯示月/日', () => {
    const ax = trendXAxis([100, 200], [100, 150, 200])
    expect(ax.domain).toEqual([100, 200])
    expect(ax.ticks).toEqual([100, 150, 200])
    expect(trendXAxis(null, []).domain).toEqual(['auto', 'auto'])
    expect(ax.tickFormatter(dayIndex('2026-09-06'))).toBe('9/6')
  })
})
