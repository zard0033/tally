import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_FACTOR_PRESETS,
  clampToPresetRange,
  computeTargets,
  formatOverAria,
  formatOverDelta,
  macroExceeds,
  nearestPreset,
  num,
  numOrNull,
  pct,
  pickBarRight,
  rateMonthlyToWeekly,
  rateWeeklyToMonthly,
  rowOverage,
  sumIntake,
  type Profile,
  type Targets,
} from './formulas'

const baseProfile: Profile = {
  sex: 'male',
  birth_year: 1993,
  height_cm: 175,
  activity_factor: 1.375,
  goal: 'cut',
  rate_kg_per_week: 0.5,
  protein_g_per_kg: 2.0,
  use_custom_targets: false,
  custom_kcal: null,
  custom_protein_g: null,
  custom_fat_g: null,
  custom_carb_g: null,
}
const today = new Date(2026, 0, 1) // 年齡＝2026－1993＝33，固定注入不受測試執行日期影響

describe('computeTargets：Mifflin-St Jeor（沒有體脂率）', () => {
  const t = computeTargets(baseProfile, 75.95, null, today)

  it('年齡 = 今年－出生年', () => {
    expect(t.age).toBe(33)
  })
  it('BMR = Mifflin-St Jeor', () => {
    expect(t.bmr).toBeCloseTo(10 * 75.95 + 6.25 * 175 - 5 * 33 + 5, 2)
  })
  it('TDEE = BMR × activity_factor', () => {
    expect(t.tdee).toBeCloseTo((t.bmr as number) * 1.375, 2)
  })
  it('減重：TDEE 減每日熱量差額（0.5 kg/週 × 7700 ÷ 7）', () => {
    const delta = (0.5 * 7700) / 7
    expect(t.kcal).toBeCloseTo((t.tdee as number) - delta, 2)
  })
  it('蛋白質 = 體重 × g/kg', () => {
    expect(t.protein).toBeCloseTo(75.95 * 2.0, 2)
  })
  it('脂肪＝體重 × 0.85 g/kg（固定）；碳水吃剩餘熱量，未捨入熱量總和 = kcal', () => {
    expect(t.fat).toBeCloseTo(75.95 * 0.85, 2)
    expect(t.carb).toBeCloseTo((t.kcal - t.protein * 4 - t.fat * 9) / 4, 2)
    expect(t.protein * 4 + t.fat * 9 + t.carb * 4).toBeCloseTo(t.kcal, 2)
  })
})

describe('computeTargets：Katch-McArdle（有體脂率）', () => {
  it('BMR 用去脂體重算，且與 Mifflin-St Jeor 不同值', () => {
    const withFat = computeTargets(baseProfile, 75.95, 22, today)
    const withoutFat = computeTargets(baseProfile, 75.95, null, today)
    const leanMass = 75.95 * (1 - 22 / 100)
    expect(withFat.bmr).toBeCloseTo(370 + 21.6 * leanMass, 2)
    expect(withFat.bmr).not.toBeCloseTo(withoutFat.bmr as number, 0)
  })
})

describe('computeTargets：目標調整', () => {
  it('goal=bulk：TDEE 加每日熱量差額', () => {
    const t = computeTargets({ ...baseProfile, goal: 'bulk' }, 75.95, null, today)
    const delta = (0.5 * 7700) / 7
    expect(t.kcal).toBeCloseTo((t.tdee as number) + delta, 2)
  })
  it('goal=maintain：不調整，rate 欄位不使用', () => {
    const t = computeTargets({ ...baseProfile, goal: 'maintain', rate_kg_per_week: null }, 75.95, null, today)
    expect(t.kcal).toBeCloseTo(t.tdee as number, 2)
  })
  it('脂肪不受目標影響，三種目標的脂肪目標相同（都是體重 × 0.85）', () => {
    const cut = computeTargets({ ...baseProfile, goal: 'cut' }, 75.95, null, today)
    const maintain = computeTargets({ ...baseProfile, goal: 'maintain', rate_kg_per_week: null }, 75.95, null, today)
    const bulk = computeTargets({ ...baseProfile, goal: 'bulk' }, 75.95, null, today)
    expect(cut.fat).toBeCloseTo(75.95 * 0.85, 2)
    expect(maintain.fat).toBeCloseTo(75.95 * 0.85, 2)
    expect(bulk.fat).toBeCloseTo(75.95 * 0.85, 2)
    expect(cut.carb).toBeLessThan(maintain.carb) // 目標熱量的增減全部反映在碳水
    expect(maintain.carb).toBeLessThan(bulk.carb)
  })
})

describe('computeTargets：自訂目標', () => {
  it('use_custom_targets=true 時直接回傳四個自訂值，不跑公式', () => {
    const t = computeTargets({
      ...baseProfile,
      use_custom_targets: true,
      custom_kcal: 1800,
      custom_protein_g: 150,
      custom_fat_g: 60,
      custom_carb_g: 180,
    }, 75.95, 22, today)
    expect(t).toMatchObject({ bmr: null, tdee: null, kcal: 1800, protein: 150, fat: 60, carb: 180 })
  })
})

describe('computeTargets：邊界情況（precommit-review 抓到的兩個真實案例）', () => {
  it('碳水夾住 0——蛋白質＋脂肪熱量吃光目標熱量時，碳水不會變負數', () => {
    // 55kg／輕度活動／減重 1.0 kg 週／2.0 g/kg：TDEE≈1483.75，kcal≈680.5，
    // 蛋白質 110g=440卡＋脂肪 46.75g=420.75卡，未夾住的話碳水會是負的
    const t = computeTargets(
      { ...baseProfile, activity_factor: 1.2, rate_kg_per_week: 1.0, protein_g_per_kg: 2.0 },
      55,
      null,
      today,
    )
    expect(t.fat).toBeCloseTo(55 * 0.85, 2) // 脂肪固定，不參與夾住
    expect(t.carb).toBe(0)
  })

  it('goal≠maintain 但 rate 是 null（例如 migration 忘記回填）：kcal 變 NaN，不靜默當成維持態', () => {
    const t = computeTargets({ ...baseProfile, goal: 'cut', rate_kg_per_week: null }, 75.95, null, today)
    expect(Number.isFinite(t.kcal)).toBe(false)
  })
})

describe('numOrNull', () => {
  it('null/undefined/非數字字串回 null', () => {
    expect(numOrNull(null)).toBeNull()
    expect(numOrNull(undefined)).toBeNull()
    expect(numOrNull('abc')).toBeNull()
  })
  it('有效數字（含數字字串）原樣回傳', () => {
    expect(numOrNull(1993)).toBe(1993)
    expect(numOrNull('1993')).toBe(1993)
  })
})

describe('rateWeeklyToMonthly／rateMonthlyToWeekly（kg/週 ↔ kg/月，52 週/12 月換算）', () => {
  it('往返一致', () => {
    expect(rateMonthlyToWeekly(rateWeeklyToMonthly(0.3))).toBeCloseTo(0.3, 9)
  })
  it('1 kg/月 ≈ 0.2308 kg/週', () => {
    expect(rateWeeklyToMonthly(0.2307692308)).toBeCloseTo(1, 6)
  })
})

describe('nearestPreset（活動量／蛋白質選單拿掉自訂後，既有值取最接近的 preset）', () => {
  it('精準命中時原樣回傳', () => {
    expect(nearestPreset(ACTIVITY_FACTOR_PRESETS, 1.375)).toBe(1.375)
  })
  it('落在中間時取最接近的一個', () => {
    expect(nearestPreset(ACTIVITY_FACTOR_PRESETS, 1.5)).toBe(1.55)
    expect(nearestPreset(ACTIVITY_FACTOR_PRESETS, 1.3)).toBe(1.375)
  })
  it('超出兩端範圍時取最近的邊界值', () => {
    expect(nearestPreset(ACTIVITY_FACTOR_PRESETS, 0.9)).toBe(1.2)
    expect(nearestPreset(ACTIVITY_FACTOR_PRESETS, 2.5)).toBe(1.9)
  })
})

describe('clampToPresetRange（送公式／寫回 DB 前的範圍防線）', () => {
  it('範圍內的值原樣通過，不吸附到 preset', () => {
    // 這條是重點：不吸附，否則 xTouchedRef「沒碰過選單就不覆寫真實值」的規則就白做了
    expect(clampToPresetRange(ACTIVITY_FACTOR_PRESETS, 1.5)).toBe(1.5)
    expect(clampToPresetRange(ACTIVITY_FACTOR_PRESETS, 1.2)).toBe(1.2)
  })
  it('超出上下界時夾到界線', () => {
    expect(clampToPresetRange(ACTIVITY_FACTOR_PRESETS, 0.1)).toBe(1.2)
    expect(clampToPresetRange(ACTIVITY_FACTOR_PRESETS, 99)).toBe(1.9)
    expect(clampToPresetRange(ACTIVITY_FACTOR_PRESETS, -5)).toBe(1.2)
  })
  it('NaN／Infinity 退回第一個 preset，不讓 NaN 傳染進 DB', () => {
    expect(clampToPresetRange(ACTIVITY_FACTOR_PRESETS, NaN)).toBe(1.2)
    expect(clampToPresetRange(ACTIVITY_FACTOR_PRESETS, Infinity)).toBe(1.2)
  })
  it('不假設 presets 已排序', () => {
    expect(clampToPresetRange([1.9, 1.2, 1.55], 99)).toBe(1.9)
    expect(clampToPresetRange([1.9, 1.2, 1.55], 0)).toBe(1.2)
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

describe('pickBarRight（DESIGN.md v2.10：超標時「剩」讓位給小計旁的 (+N)）', () => {
  it('今日未超標：remainText 有值、deltaText 空、over 為 false', () => {
    const r = pickBarRight(true, 900, 1860, 300)
    expect(r).toMatchObject({ remainText: '剩 660', deltaText: '', over: false })
  })
  it('今日超標：deltaText 有值、remainText 讓位成空字串', () => {
    const r = pickBarRight(true, 1500, 1860, 400)
    expect(r).toMatchObject({ remainText: '', deltaText: '(+40)', over: true })
  })
  it('剛好打平（== 不算超標）：走 remainText 那條、不是 deltaText', () => {
    const r = pickBarRight(true, 1000, 1860, 860)
    expect(r).toMatchObject({ remainText: '剩 0', deltaText: '', over: false })
  })
  it('非今日（歷史日）：一律「共 X」，deltaText 恆空、over 恆 false', () => {
    const r = pickBarRight(false, 1500, 1860, 400)
    expect(r).toMatchObject({ remainText: '共 1900', deltaText: '', over: false })
  })
})

const targets: Targets = { age: 0, bmr: 0, tdee: 0, kcal: 1860, protein: 126, fat: 56, carb: 214 }

describe('rowOverage（逐筆超標預警，DESIGN.md v2.10——不含蛋白質）', () => {
  it('三項都沒超標時全部回 0', () => {
    const base = { kcal: 1000, protein: 60, fat: 20, carb: 100 }
    expect(rowOverage(base, 100, 5, 20, targets)).toEqual({ kcal: 0, fat: 0, carb: 0 })
  })
  it('只有熱量被推過線，脂肪／碳水仍在範圍內', () => {
    const base = { kcal: 1800, protein: 60, fat: 20, carb: 100 }
    expect(rowOverage(base, 100, 5, 20, targets)).toEqual({ kcal: 40, fat: 0, carb: 0 })
  })
  it('已勾選的這一筆（base 已含它）——加 0/0/0 不重複疊加', () => {
    const base = { kcal: 1900, protein: 60, fat: 60, carb: 100 }
    expect(rowOverage(base, 0, 0, 0, targets)).toEqual({ kcal: 40, fat: 4, carb: 0 })
  })
  it('== 不算超標，判定用捨入後的值（同 macroExceeds 的粒度）', () => {
    const base = { kcal: 1860, protein: 0, fat: 0, carb: 0 }
    expect(rowOverage(base, 0, 0, 0, targets).kcal).toBe(0)
  })
})

describe('formatOverDelta（視覺版，不含熱量——kc 數字變色已經是那個訊號，避免三重複）', () => {
  it('三個都觸發：熱量不出現在文字裡，只列脂肪／碳水', () => {
    expect(formatOverDelta({ kcal: 110, fat: 26, carb: 12 })).toBe('+26g脂 +12g碳')
  })
  it('只有熱量觸發、脂肪碳水都沒有：回空字串（kc 數字自己變色就夠了）', () => {
    expect(formatOverDelta({ kcal: 110, fat: 0, carb: 0 })).toBe('')
  })
  it('只有脂肪觸發：其餘不出現', () => {
    expect(formatOverDelta({ kcal: 0, fat: 7, carb: 0 })).toBe('+7g脂')
  })
  it('全部沒觸發：空字串，呼叫端據此不畫這一行', () => {
    expect(formatOverDelta({ kcal: 0, fat: 0, carb: 0 })).toBe('')
  })
  it('超出量在 0.1~0.4 之間：捨到整數是 0，不該顯示「+0g」（precommit review 2026-08-01 抓到）', () => {
    expect(formatOverDelta({ kcal: 0, fat: 0.3, carb: 0.4 })).toBe('')
  })
  it('超出量剛好到 0.5：捨入後是 1，該顯示', () => {
    expect(formatOverDelta({ kcal: 0, fat: 0.5, carb: 0 })).toBe('+1g脂')
  })
})

describe('formatOverAria（口語版，三項都照唸——螢幕閱讀器沒有顏色可以借）', () => {
  it('三個都觸發：熱量也要唸出來，跟 formatOverDelta 不同', () => {
    expect(formatOverAria({ kcal: 110, fat: 26, carb: 12 }))
      .toBe('熱量會超出 110 大卡，脂肪會超出 26 克，碳水會超出 12 克')
  })
  it('只有熱量觸發：formatOverDelta 這時是空字串，但 aria 版仍要講', () => {
    expect(formatOverAria({ kcal: 110, fat: 0, carb: 0 })).toBe('熱量會超出 110 大卡')
  })
  it('超出量在 0.1~0.4 之間：捨到整數是 0，不該唸「超出 0 克」', () => {
    expect(formatOverAria({ kcal: 0.2, fat: 0, carb: 0 })).toBe('')
  })
})
