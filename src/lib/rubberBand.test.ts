import { describe, expect, it } from 'vitest'
import { RUBBER_BAND_MAX, rubberBand } from './rubberBand'

describe('rubberBand', () => {
  it('沒超出邊界就是 0', () => {
    expect(rubberBand(0)).toBe(0)
  })

  it('保留方向：往上超出（負）回負、往下超出（正）回正', () => {
    expect(rubberBand(30)).toBeGreaterThan(0)
    expect(rubberBand(-30)).toBeLessThan(0)
    expect(rubberBand(-30)).toBe(-rubberBand(30))
  })

  it('絕對值永遠小於上限，再用力拉也不會超過', () => {
    for (const d of [1, 10, 50, 200, 5000, 1e6]) {
      expect(Math.abs(rubberBand(d))).toBeLessThan(RUBBER_BAND_MAX)
    }
  })

  it('越拉越慢：露出量遞增，但每多拉一段增加得越少', () => {
    const a = rubberBand(20)
    const b = rubberBand(40)
    const c = rubberBand(60)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(c - b).toBeLessThan(b - a)
  })

  it('上限可指定', () => {
    expect(Math.abs(rubberBand(1e6, 30))).toBeLessThan(30)
    expect(Math.abs(rubberBand(1e6, 30))).toBeGreaterThan(29)
  })
})
