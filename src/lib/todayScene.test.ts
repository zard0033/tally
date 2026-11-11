import { describe, expect, it } from 'vitest'
import { DAY_END_MIN, DAY_START_MIN, FIXED_SCENE_MIN, NO_STONES, nextMeal, rememberStones, skyAt, stonesFor } from './todayScene'
import type { MealKey } from './meals'

const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m)
const set = (...keys: MealKey[]) => new Set<MealKey>(keys)

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

describe('nextMeal', () => {
  it('現在時段那一餐還沒記，就是它', () => {
    expect(nextMeal(set(), at(8))).toBe('breakfast')
    expect(nextMeal(set('breakfast', 'lunch'), at(19, 20))).toBe('dinner')
  })

  it('現在時段那一餐記了，往後找第一個還沒記的', () => {
    expect(nextMeal(set('lunch'), at(13))).toBe('dinner')
    expect(nextMeal(set('lunch', 'dinner'), at(13))).toBe('snack')
  })

  it('往前漏記的不算（早上沒記，下午不會回頭亮早餐）', () => {
    expect(nextMeal(set(), at(16))).toBe('dinner')
  })

  it('後面全記了就沒有', () => {
    expect(nextMeal(set('snack'), at(22))).toBeNull()
  })
})

describe('stonesFor', () => {
  it('四餐依序，記過的亮、下一塊標 next、其餘 todo', () => {
    expect(stonesFor(set('breakfast', 'lunch'), 'dinner').map((s) => [s.label, s.state])).toEqual([
      ['早餐', 'done'],
      ['午餐', 'done'],
      ['晚餐', 'next'],
      ['點心', 'todo'],
    ])
  })

  it('記過的餐就算剛好是 next 也是 done', () => {
    expect(stonesFor(set('dinner'), 'dinner')[2].state).toBe('done')
  })
})

describe('rememberStones', () => {
  it('還沒讀到過、又在載入中：什麼都不知道，不是「四餐都沒記」', () => {
    expect(rememberStones(NO_STONES, null)).toBe(NO_STONES)
    expect(NO_STONES.known).toBeNull()
  })

  it('第一次讀到資料：記下基準、一塊都不彈（冷開機時本來就記過的不算剛亮）', () => {
    const mem = rememberStones(NO_STONES, set('breakfast', 'lunch'))
    expect([...mem.known!]).toEqual(['breakfast', 'lunch'])
    expect(mem.lit.size).toBe(0)
  })

  it('存檔後重撈：載入中沿用上一份，資料回來只彈新記的那餐', () => {
    const before = rememberStones(NO_STONES, set('lunch'))
    const loading = rememberStones(before, null)
    expect(loading).toBe(before)
    expect([...loading.known!]).toEqual(['lunch'])
    const after = rememberStones(loading, set('lunch', 'breakfast'))
    expect([...after.lit]).toEqual(['breakfast'])
  })

  it('重撈回來內容一樣（新的 Set、同樣幾餐）：回傳同一個物件，剛亮的那塊不被洗掉', () => {
    const lit = rememberStones(rememberStones(NO_STONES, set('lunch')), set('lunch', 'dinner'))
    expect(rememberStones(lit, set('dinner', 'lunch'))).toBe(lit)
  })

  it('刪掉一餐：沒有新亮的，lit 清空；復原回來那餐再彈一次', () => {
    const two = rememberStones(rememberStones(NO_STONES, set('lunch')), set('lunch', 'dinner'))
    const one = rememberStones(two, set('lunch'))
    expect(one.lit.size).toBe(0)
    expect([...rememberStones(one, set('lunch', 'dinner')).lit]).toEqual(['dinner'])
  })
})
