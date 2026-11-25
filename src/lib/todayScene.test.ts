import { describe, expect, it } from 'vitest'
import { DAY_END_MIN, DAY_START_MIN, FIXED_SCENE_MIN, skyAt } from './todayScene'

describe('skyAt', () => {
  it('日出前、日落後是月亮', () => {
    expect(skyAt(DAY_START_MIN - 1)).toEqual({ kind: 'moon' })
    expect(skyAt(DAY_END_MIN + 1)).toEqual({ kind: 'moon' })
    expect(skyAt(0)).toEqual({ kind: 'moon' })
  })

  it('日出貼著地平線、正午最高、日落又回地平線', () => {
    const rise = skyAt(DAY_START_MIN)
    const set_ = skyAt(DAY_END_MIN)
    const noon = skyAt((DAY_START_MIN + DAY_END_MIN) / 2)
    expect(rise).toEqual({ kind: 'sun', t: 0, h: 0 })
    expect(set_.kind === 'sun' && set_.t).toBe(1)
    expect(set_.kind === 'sun' && set_.h).toBeCloseTo(0, 10)
    expect(noon.kind === 'sun' && noon.h).toBeCloseTo(1, 10)
  })

  it('早上八點在弧線左半、還在爬；下午三點在右半、在下降', () => {
    const am = skyAt(8 * 60)
    const pm = skyAt(FIXED_SCENE_MIN)
    if (am.kind !== 'sun' || pm.kind !== 'sun') throw new Error('白天該是太陽')
    expect(am.t).toBeCloseTo(150 / 795, 10)
    expect(pm.t).toBeGreaterThan(0.5)
    expect(pm.h).toBeLessThan(1)
  })
})
