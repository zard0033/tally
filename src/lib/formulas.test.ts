import { describe, expect, it } from 'vitest'
import {
  computeTargets,
  macroExceeds,
  macroPercentagesSumTo100,
  normalizeMacroPercentages,
  num,
  pct,
  sumIntake,
  type Profile,
} from './formulas'

/* 這組 profile 對應 legacy/app.js check() 裡 active.md 的定案值：
   75.95kg → BMR 1690.9 → 1860 kcal / P126 / F56 / C214（公式鏈本身的自我一致性驗證） */
const baseProfile: Profile = {
  sex: 'male',
  birth_date: '1993-01-01',
  height_cm: 175,
  activity_factor: 1.375,
  goal: 'cut',
  protein_pct: 27,
  fat_pct: 27,
  carb_pct: 46,
}

describe('computeTargets 公式鏈自我一致性', () => {
  const t = computeTargets(baseProfile, 75.95)

  it('BMR = Mifflin-St Jeor', () => {
    expect(t.bmr).toBeCloseTo(10 * 75.95 + 6.25 * 175 - 5 * t.age + 5, 2)
  })
  it('TDEE = BMR × activity_factor', () => {
    expect(t.tdee).toBeCloseTo(t.bmr * 1.375, 2)
  })
  it('kcal = TDEE × 0.8（減重）', () => {
    expect(t.kcal).toBeCloseTo(t.tdee * 0.8, 2)
  })
  it('三大營養素未捨入熱量總和 = kcal', () => {
    expect(t.protein * 4 + t.fat * 9 + t.carb * 4).toBeCloseTo(t.kcal, 2)
  })
  it('P@1860/F@1860/C@1860 落在 active.md 定案值 ±0.5 內', () => {
    expect(Math.abs((1860 * 0.27) / 4 - 126)).toBeLessThanOrEqual(0.5)
    expect(Math.abs((1860 * 0.27) / 9 - 56)).toBeLessThanOrEqual(0.5)
    expect(Math.abs((1860 * 0.46) / 4 - 214)).toBeLessThanOrEqual(0.5)
  })

  it('比例改讀 profile：換一組比例，目標跟著動，但熱量不變', () => {
    const t2 = computeTargets({ ...baseProfile, protein_pct: 40, fat_pct: 20, carb_pct: 40 }, 75.95)
    expect(t2.protein).toBeCloseTo((t2.kcal * 0.4) / 4, 2)
    expect(t2.kcal).toBeCloseTo(t.kcal, 2)
  })

  it('goal=bulk：TDEE + 500', () => {
    const tb = computeTargets({ ...baseProfile, goal: 'bulk' }, 75.95)
    expect(tb.kcal).toBeCloseTo(tb.tdee + 500, 2)
  })

  it('goal=maintain：不調整', () => {
    const tm = computeTargets({ ...baseProfile, goal: 'maintain' }, 75.95)
    expect(tm.kcal).toBeCloseTo(tm.tdee, 2)
  })
})

/* 已驗證的線上實值：profile = 體重 75.95、身高 173、年齡 31、activity_factor 1.375、
   目標減重、pct 27/27/46 時 → BMR 1691 → TDEE 2325 → 目標 1860 kcal / P126 / F56 / C214。
   用固定 today 注入把「年齡 31」釘死，不受測試執行日期影響。 */
describe('公式鏈整合斷言（已驗證的線上實值）', () => {
  const today = new Date(2026, 0, 1) // 2026-01-01
  const profile: Profile = {
    sex: 'male',
    birth_date: '1995-01-01', // 在 today 當天剛好滿 31 歲
    height_cm: 173,
    activity_factor: 1.375,
    goal: 'cut',
    protein_pct: 27,
    fat_pct: 27,
    carb_pct: 46,
  }
  const t = computeTargets(profile, 75.95, today)

  it('年齡 31', () => {
    expect(t.age).toBe(31)
  })
  it('BMR ≈ 1691', () => {
    expect(Math.round(t.bmr)).toBe(1691)
  })
  it('TDEE ≈ 2325', () => {
    expect(Math.round(t.tdee)).toBe(2325)
  })
  it('目標熱量 ≈ 1860 kcal', () => {
    expect(Math.round(t.kcal)).toBe(1860)
  })
  it('蛋白質 ≈ 126 g', () => {
    expect(Math.round(t.protein)).toBe(126)
  })
  it('脂肪 ≈ 56 g', () => {
    expect(Math.round(t.fat)).toBe(56)
  })
  it('碳水 ≈ 214 g', () => {
    expect(Math.round(t.carb)).toBe(214)
  })
})

describe('pct', () => {
  it('分母為 0 回 0', () => {
    expect(pct(10, 0)).toBe(0)
  })
  it('NaN 回 0', () => {
    expect(pct(NaN, 100)).toBe(0)
  })
  it('破表夾住 100', () => {
    expect(pct(227.9, 214)).toBe(100)
  })
})

describe('sumIntake', () => {
  it('未捨入加總', () => {
    expect(sumIntake([{ qty: 3, kcal: 10.4, protein: 0, fat: 0, carb: 0 }]).kcal).toBeCloseTo(31.2, 3)
  })
})

describe('num', () => {
  it('null/undefined 回 NaN', () => {
    expect(Number.isNaN(num(null))).toBe(true)
    expect(Number.isNaN(num(undefined))).toBe(true)
  })
  it('其餘交給 Number()', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num(3)).toBe(3)
  })
})

describe('macroExceeds（破表判定要跟顯示同粒度）', () => {
  it('126.4 對 126 應判破表', () => {
    expect(macroExceeds(126.4, 126)).toBe(true)
  })
  it('126.04 捨入後相等，不該判破表', () => {
    expect(macroExceeds(126.04, 126)).toBe(false)
  })
})

describe('三大比例驗證：DB 是 numeric(4,1)，先各自捨入再檢查和＝100', () => {
  it('33.33 × 3 應該被擋下（捨入後 99.9）', () => {
    expect(macroPercentagesSumTo100({ protein_pct: 33.33, fat_pct: 33.33, carb_pct: 33.34 })).toBe(false)
  })
  it('27/27/46 應該通過', () => {
    expect(macroPercentagesSumTo100({ protein_pct: 27, fat_pct: 27, carb_pct: 46 })).toBe(true)
  })
  it('一位小數（30.5/24.5/45）應該通過', () => {
    expect(macroPercentagesSumTo100({ protein_pct: 30.5, fat_pct: 24.5, carb_pct: 45 })).toBe(true)
  })
  it('normalizeMacroPercentages 捨入到一位小數', () => {
    expect(normalizeMacroPercentages({ protein_pct: 33.333, fat_pct: 33.333, carb_pct: 33.334 }))
      .toEqual({ protein_pct: 33.3, fat_pct: 33.3, carb_pct: 33.3 })
  })
})
