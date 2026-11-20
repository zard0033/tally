import { describe, expect, it } from 'vitest'
import { BODY_FAT_MAX, BODY_FAT_MIN, fmt1, signed1, withPlan, planAt, spanDomain, isValidBodyFatPct, isValidWeightKg, isoOfDay, niceDomain, rangeStart, sparklinePoints, trendPoints, trendTickLabel, xDomain, xTicks, yTicks, type TrendRow } from './weightTrend'
import { dayIndex, shiftDate } from './dates'
import { plannedWeeklyKg } from './formulas'

const row = (measured_on: string, weight_kg: number | string, body_fat_pct: number | string | null = null): TrendRow =>
  ({ weight_kg, measured_on, body_fat_pct })

describe('dayIndex／isoOfDay', () => {
  it('互為反運算，跨月跨年閏日都對', () => {
    for (const iso of ['2026-10-20', '2026-01-01', '2024-02-29', '2025-12-31']) {
      expect(isoOfDay(dayIndex(iso))).toBe(iso)
    }
    expect(dayIndex('2026-03-01') - dayIndex('2026-02-28')).toBe(1)
    expect(dayIndex('2024-03-01') - dayIndex('2024-02-28')).toBe(2)
  })
})

describe('rangeStart', () => {
  it('30 天＝今天加前 29 天；全部沒有下界', () => {
    expect(rangeStart('30', '2026-10-20')).toBe('2026-09-21')
    expect(rangeStart('90', '2026-10-20')).toBe('2026-07-23')
    expect(rangeStart('all', '2026-10-20')).toBeNull()
  })
})

describe('trendPoints', () => {
  it('趨勢是指數平滑：第一筆是起點，隔 d 天的一筆佔 1 − 0.9^d', () => {
    // 10/1 80 → 10/4 82（隔 3 天，佔 0.271）→ 80.542 → 10/8 84（隔 4 天，佔 0.3439）→ 81.7312062
    const pts = trendPoints([row('2026-10-01', 80), row('2026-10-04', 82), row('2026-10-08', 84)], 'all', '2026-10-08')
    expect(pts[0].trend).toBe(80)
    expect(pts[1].trend).toBeCloseTo(80.542, 10)
    expect(pts[2].trend).toBeCloseTo(81.7312062, 10)
  })

  it('每天量同一個值：趨勢就是那個值；每天量一筆跳 1 kg：趨勢只動 0.1', () => {
    const flat = trendPoints([1, 2, 3, 4].map((d) => row(`2026-10-0${d}`, 75)), 'all', '2026-10-04')
    expect(flat.map((p) => p.trend)).toEqual([75, 75, 75, 75])
    const jump = trendPoints([row('2026-10-01', 75), row('2026-10-02', 76)], 'all', '2026-10-02')
    expect(jump[1].trend).toBeCloseTo(75.1, 10)
  })

  it('趨勢先對全部歷史算再切範圍：範圍外的舊資料仍拉著範圍內第一點', () => {
    const rows = [row('2026-10-17', 80), row('2026-10-19', 82), row('2026-10-20', 84)]
    const old = trendPoints([row('2026-08-01', 70), ...rows], '30', '2026-10-20')
    expect(old.map((p) => p.date)).toEqual(['2026-10-17', '2026-10-19', '2026-10-20'])
    // 8/1 → 10/17 隔 77 天：70 + (1 − 0.9^77) × 10
    expect(old[0].trend).toBeCloseTo(80 - 10 * 0.9 ** 77, 10)
  })

  it('範圍切片依今天往前數，不是依最後一筆', () => {
    const rows = [row('2026-08-30', 80), row('2026-09-20', 81), row('2026-09-21', 82), row('2026-10-20', 83)]
    expect(trendPoints(rows, '30', '2026-10-20').map((p) => p.date)).toEqual(['2026-09-21', '2026-10-20'])
    expect(trendPoints(rows, 'all', '2026-10-20')).toHaveLength(4)
  })

  it('輸入亂序也由舊到新；PostgREST 的 numeric 字串照樣算', () => {
    const pts = trendPoints([row('2026-10-02', '81.5', '20.5'), row('2026-10-01', '80.5')], 'all', '2026-10-02')
    expect(pts.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02'])
    expect(pts.map((p) => p.kg)).toEqual([80.5, 81.5])
    expect(pts[0].fat).toBeNull()
    expect(pts[1].fat).toBe(20.5)
    expect(pts[1].trend).toBeCloseTo(80.6, 10)
  })

  it('體重不是有限數字的列整筆丟掉；體脂壞掉當沒填', () => {
    const pts = trendPoints([row('2026-10-01', 'abc'), row('2026-10-02', 80, 'x')], 'all', '2026-10-02')
    expect(pts).toHaveLength(1)
    expect(pts[0].fat).toBeNull()
  })

  it('空輸入回空陣列', () => {
    expect(trendPoints([], 'all', '2026-10-20')).toEqual([])
  })
})

describe('xDomain／xTicks', () => {
  const pts = trendPoints([row('2026-09-30', 80), row('2026-10-10', 81)], 'all', '2026-10-20')

  it('固定範圍＝[起點, 今天]；全部＝[第一筆, 今天]；沒資料 null', () => {
    expect(xDomain(pts, '30', '2026-10-20')).toEqual([dayIndex('2026-09-21'), dayIndex('2026-10-20')])
    expect(xDomain(pts, 'all', '2026-10-20')).toEqual([dayIndex('2026-09-30'), dayIndex('2026-10-20')])
    expect(xDomain([], 'all', '2026-10-20')).toBeNull()
  })

  it('刻度含兩端、等距；範圍只有一天只給一個', () => {
    expect(xTicks(0, 30, 4)).toEqual([0, 10, 20, 30])
    expect(xTicks(5, 5)).toEqual([5])
  })
})

describe('yTicks', () => {
  it('minStep：矮的小圖至少每 minStep 一條', () => {
    expect(yTicks([22, 26], 2)).toEqual([22, 24, 26])
    expect(yTicks([22, 26])).toEqual([22, 23, 24, 25, 26])
  })
  it('依範圍大小選步長，刻度落在步長整數倍、含兩端（兩端本身是倍數時）', () => {
    expect(yTicks([76, 85])).toEqual([76, 78, 80, 82, 84])
    expect(yTicks([75, 79])).toEqual([75, 76, 77, 78, 79])
    expect(yTicks([60, 90])).toEqual([60, 65, 70, 75, 80, 85, 90])
    expect(yTicks([50, 120])).toEqual([50, 60, 70, 80, 90, 100, 110, 120])
  })

  it('下界不是步長倍數時從第一個倍數開始，不超出範圍', () => {
    expect(yTicks([61, 74])).toEqual([65, 70])
  })
})

describe('niceDomain', () => {
  it('上下留 pad 再對齊 step', () => {
    expect(niceDomain([75.9, 78.2], 0.3, 1)).toEqual([75, 79])
    expect(niceDomain([20.5, 22], 0.5, 1)).toEqual([20, 23])
  })

  it('資料剛好落在整數也會留出 pad，線不貼邊', () => {
    expect(niceDomain([76, 78], 0.3, 1)).toEqual([75, 79])
  })

  it('沒資料回 [0, 1]', () => {
    expect(niceDomain([], 0.3, 1)).toEqual([0, 1])
  })
})

describe('fmt1', () => {
  it('固定一位小數：整數補 .0、多位捨入', () => {
    expect(fmt1(72)).toBe('72.0')
    expect(fmt1(72.46)).toBe('72.5')
    expect(fmt1(0.04)).toBe('0.0')
  })
})

describe('trendTickLabel', () => {
  it('日序顯示成月/日', () => {
    expect(trendTickLabel(dayIndex('2026-09-06'))).toBe('9/6')
  })
})

describe('sparklinePoints', () => {
  it('寬 120 高 32：x 等距、y 以最小/最大線性映射到 28..4（大的在上）', () => {
    // 70、72、71：stepX 60；y = 28 - (v-70)/2*24 → 28、4、16
    expect(sparklinePoints([{ weight_kg: 70 }, { weight_kg: 72 }, { weight_kg: 71 }]))
      .toBe('0.0,28.0 60.0,4.0 120.0,16.0')
  })
  it('全部同值（span 0）不除以零，貼底線 28', () => {
    expect(sparklinePoints([{ weight_kg: 70 }, { weight_kg: 70 }])).toBe('0.0,28.0 120.0,28.0')
  })
  it('weight_kg 是字串（numeric 欄位從 API 回來的形狀）也能算', () => {
    expect(sparklinePoints([{ weight_kg: '70.5' }, { weight_kg: '71.5' }])).toBe('0.0,28.0 120.0,4.0')
  })
})

describe('記體重的門檻', () => {
  it('體重必須大於 0 的有限數字', () => {
    expect(isValidWeightKg(0.1)).toBe(true)
    expect(isValidWeightKg(0)).toBe(false)
    expect(isValidWeightKg(-1)).toBe(false)
    expect(isValidWeightKg(Number.NaN)).toBe(false)
    expect(isValidWeightKg(Infinity)).toBe(false)
  })
  it('體脂率 3–70（含兩端）', () => {
    expect([BODY_FAT_MIN, BODY_FAT_MAX]).toEqual([3, 70])
    expect(isValidBodyFatPct(3)).toBe(true)
    expect(isValidBodyFatPct(70)).toBe(true)
    expect(isValidBodyFatPct(2.9)).toBe(false)
    expect(isValidBodyFatPct(70.1)).toBe(false)
    expect(isValidBodyFatPct(Number.NaN)).toBe(false)
  })
})

describe('計畫線（v2.137）', () => {
  it('計畫線從第一點的趨勢起，照每週速度走', () => {
    const pts = withPlan([{ t: 100, trend: 80 }, { t: 107, trend: 79.9 }, { t: 114, trend: 80.2 }], -0.3)
    expect(pts.map((p) => p.plan)).toEqual([80, 79.7, 79.4].map((v) => expect.closeTo(v, 10)))
  })
  it('自訂目標（沒有速度）不畫計畫線', () => {
    expect(withPlan([{ t: 100, trend: 80 }], null)[0].plan).toBeNull()
  })
  it('planAt：照計畫某天該在幾公斤（可以在最後一筆之後，例如今天）；沒有點回 null', () => {
    expect(planAt([{ t: 100, trend: 80 }, { t: 107, trend: 81 }], -0.7, 120)).toBeCloseTo(78, 10)
    expect(planAt([], -0.7, 120)).toBeNull()
  })
  it('signed1：正負號用減號、一位小數；捨入到 0 寫 ±0.0', () => {
    expect(signed1(-1.04)).toBe('−1.0')
    expect(signed1(0.26)).toBe('+0.3')
    expect(signed1(-0.04)).toBe('±0.0')
  })
})

describe('plannedWeeklyKg', () => {
  const p = (goal: 'cut' | 'bulk' | 'maintain', rate: number | string | null, custom = false) =>
    ({ goal, rate_kg_per_week: rate, use_custom_targets: custom })
  it('減重為負、增肌為正、維持 0', () => {
    expect(plannedWeeklyKg(p('cut', 0.29))).toBe(-0.29)
    expect(plannedWeeklyKg(p('bulk', '0.25'))).toBe(0.25)
    expect(plannedWeeklyKg(p('maintain', null))).toBe(0)
  })
  it('自訂目標或速度缺失：沒有計畫可比', () => {
    expect(plannedWeeklyKg(p('cut', 0.29, true))).toBeNull()
    expect(plannedWeeklyKg(p('cut', null))).toBeNull()
  })
})

describe('量法斷點只切體脂（v2.146）', () => {
  const T = '2026-11-14'
  const r = (off: number, kg: number, fat: number | null, brk = false): TrendRow => ({ weight_kg: kg, measured_on: shiftDate(T, off), body_fat_pct: fat, method_break: brk })

  it('體重趨勢跨過斷點照常連續；體脂趨勢在斷點重新起算', () => {
    const pts = trendPoints([r(-2, 75, 20), r(-1, 76, 20), r(0, 76, 22, true)], '30', T)
    expect(pts.map((p) => p.brk)).toEqual([false, false, true])
    expect(pts.map((p) => p.seg)).toEqual([0, 0, 1])
    // 體重：75 → 75.1 → 75.19（沒有在斷點重來）
    expect(pts[2].trend).toBeCloseTo(75.19, 10)
    // 體脂：20 → 20 → 斷點後從 22 重新起算（不跟 20 平均成 20.2）
    expect(pts.map((p) => p.fatTrend)).toEqual([20, 20, 22])
  })

  it('斷點那天沒填體脂：從之後第一筆有填的重新起算；沒填的列 fatTrend 是 null', () => {
    const pts = trendPoints([r(-3, 75, 20), r(-2, 75, null, true), r(-1, 75, 23), r(0, 75, 24)], '30', T)
    expect(pts.map((p) => p.fatTrend)).toEqual([20, null, 23, expect.closeTo(23.1, 10)])
  })

  it('標了斷點，體重趨勢跟沒標完全一樣', () => {
    const rows = [r(-20, 75, 20), r(-12, 77, 22, true), r(-4, 77, 22), r(0, 76, 22)]
    const plain = trendPoints(rows.map((x) => ({ ...x, method_break: false })), '30', T)
    expect(trendPoints(rows, '30', T).map((p) => p.trend)).toEqual(plain.map((p) => p.trend))
  })
})

describe('spanDomain（v2.146）', () => {
  it('資料夠寬時同 niceDomain', () => {
    expect(spanDomain([70, 78], 0.3, 1, 4)).toEqual(niceDomain([70, 78], 0.3, 1))
  })
  it('資料太窄：以中點撐開到至少 minSpan，邊界對齊 step', () => {
    // 75.6–76.4，中點 76 → [74, 78]
    expect(spanDomain([75.6, 76.4], 0.3, 1, 4)).toEqual([74, 78])
    const [lo, hi] = spanDomain([24.1, 24.3], 0.5, 2, 4)
    expect(hi - lo).toBeGreaterThanOrEqual(4)
    expect(lo % 2).toBe(0)
    expect(lo).toBeLessThanOrEqual(24.1)
    expect(hi).toBeGreaterThanOrEqual(24.3)
  })
  it('沒資料回 [0, 1]', () => {
    expect(spanDomain([], 0.3, 1, 4)).toEqual([0, 1])
  })
})
